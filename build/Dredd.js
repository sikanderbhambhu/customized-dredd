"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const async_1 = __importDefault(require("async"));
const parse_1 = __importDefault(require("dredd-transactions/parse"));
const compile_1 = __importDefault(require("dredd-transactions/compile"));
const configureReporters_1 = __importDefault(require("./configureReporters"));
const resolveLocations_1 = __importDefault(require("./resolveLocations"));
const readLocation_1 = __importDefault(require("./readLocation"));
const resolveModule_1 = __importDefault(require("./resolveModule"));
const logger_1 = __importDefault(require("./logger"));
const TransactionRunner_1 = __importDefault(require("./TransactionRunner"));
const configuration_1 = require("./configuration");
const annotationToLoggerInfo_1 = __importDefault(require("./annotationToLoggerInfo"));
function prefixError(error, prefix) {
    error.message = `${prefix}: ${error.message}`;
    return error;
}
function prefixErrors(decoratedCallback, prefix) {
    return (error, ...args) => {
        if (error) {
            prefixError(error, prefix);
        }
        decoratedCallback(error, ...args);
    };
}
function readLocations(locations, options, callback) {
    const usesOptions = typeof options !== 'function';
    const resolvedOptions = usesOptions ? options : {};
    const resolvedCallback = usesOptions ? callback : options;
    async_1.default.map(locations, (location, next) => {
        const decoratedNext = prefixErrors(next, `Unable to load API description document from '${location}'`);
        readLocation_1.default(location, resolvedOptions, decoratedNext);
    }, (error, contents) => {
        if (error) {
            resolvedCallback(error);
            return;
        }
        const apiDescriptions = locations.map((location, i) => ({
            location,
            content: contents[i],
        }));
        resolvedCallback(null, apiDescriptions);
    });
}
function parseContent(apiDescriptions, callback) {
    async_1.default.map(apiDescriptions, ({ location, content }, next) => {
        const decoratedNext = prefixErrors(next, `Unable to parse API description document '${location}'`);
        parse_1.default(content, decoratedNext);
    }, (error, parseResults) => {
        if (error) {
            callback(error);
            return;
        }
        const parsedAPIdescriptions = apiDescriptions.map((apiDescription, i) => Object.assign({}, parseResults[i], apiDescription));
        callback(null, parsedAPIdescriptions);
    });
}
function compileTransactions(apiDescriptions) {
    return apiDescriptions
        .map(({ mediaType, apiElements, location }) => {
        try {
            return compile_1.default(mediaType, apiElements, location);
        }
        catch (error) {
            throw prefixError(error, 'Unable to compile HTTP transactions from ' +
                `API description document '${location}': ${error.message}`);
        }
    })
        .map((compileResult, i) => Object.assign({}, compileResult, apiDescriptions[i]));
}
function toTransactions(apiDescriptions) {
    return (apiDescriptions
        // produce an array of transactions for each API description,
        // where each transaction object gets an extra 'apiDescription'
        // property with details about the API description it comes from
        .map((apiDescription) => apiDescription.transactions.map((transaction) => Object.assign({
        apiDescription: {
            location: apiDescription.location,
            mediaType: apiDescription.mediaType,
        },
    }, transaction)))
        // flatten array of arrays
        .reduce((flatArray, array) => flatArray.concat(array), []));
}
function toLoggerInfos(apiDescriptions) {
    return apiDescriptions
        .map((apiDescription) => apiDescription.annotations.map((annotation) => annotationToLoggerInfo_1.default(apiDescription.location, annotation)))
        .reduce((flatAnnotations, annotations) => flatAnnotations.concat(annotations), []);
}
class Dredd {
    constructor(config) {
        this.configuration = configuration_1.applyConfiguration(config);
        this.stats = {
            tests: 0,
            failures: 0,
            errors: 0,
            passes: 0,
            skipped: 0,
            start: 0,
            end: 0,
            duration: 0,
        };
        this.transactionRunner = new TransactionRunner_1.default(this.configuration);
        this.logger = logger_1.default;
    }
    prepareAPIdescriptions(callback) {
        this.logger.debug('Resolving locations of API description documents');
        let locations;
        try {
            locations = resolveLocations_1.default(this.configuration.custom.cwd, this.configuration.path);
        }
        catch (error) {
            process.nextTick(() => callback(error));
            return;
        }
        async_1.default.waterfall([
            (next) => {
                this.logger.debug('Reading API description documents');
                readLocations(locations, { http: this.configuration.http }, next);
            },
            (apiDescriptions, next) => {
                const allAPIdescriptions = this.configuration.apiDescriptions.concat(apiDescriptions);
                this.logger.debug('Parsing API description documents');
                parseContent(allAPIdescriptions, next);
            },
        ], (error, apiDescriptions) => {
            if (error) {
                callback(error);
                return;
            }
            this.logger.debug('Compiling HTTP transactions from API description documents');
            let apiDescriptionsWithTransactions;
            try {
                apiDescriptionsWithTransactions = compileTransactions(apiDescriptions);
            }
            catch (compileErr) {
                callback(compileErr);
                return;
            }
            callback(null, apiDescriptionsWithTransactions);
        });
    }
    run(callback) {
        this.logger.debug('Resolving --require');
        if (this.configuration.require) {
            const requirePath = resolveModule_1.default(this.configuration.custom.cwd, this.configuration.require);
            try {
                require(requirePath); // eslint-disable-line global-require, import/no-dynamic-require
            }
            catch (error) {
                callback(error, this.stats);
                return;
            }
        }
        this.logger.debug('Configuring reporters');
        configureReporters_1.default(this.configuration, this.stats, this.transactionRunner);
        // FIXME: 'configureReporters()' pollutes the 'stats' object with
        // this property. Which is unfortunate, as the 'stats' object is
        // a part of Dredd's public interface. This line cleans it up for now, but
        // ideally the property wouldn't be needed at all.
        delete this.stats.fileBasedReporters;
        this.logger.debug('Preparing API description documents');
        this.prepareAPIdescriptions((error, apiDescriptions) => {
            if (error) {
                callback(error, this.stats);
                return;
            }
            const loggerInfos = toLoggerInfos(apiDescriptions);
            // FIXME: Winston 3.x supports calling .log() directly with the loggerInfo
            // object as it's sole argument, but that's not the case with Winston 2.x
            // Once we upgrade Winston, the line below can be simplified to .log(loggerInfo)
            //
            // Watch https://github.com/apiaryio/dredd/issues/1225 for updates
            loggerInfos.forEach(({ level, message }) => this.logger.log(level, message));
            if (loggerInfos.find((loggerInfo) => loggerInfo.level === 'error')) {
                callback(new Error('API description processing error'), this.stats);
                return;
            }
            this.logger.debug('Starting the transaction runner');
            this.configuration.apiDescriptions = apiDescriptions;
            this.transactionRunner.config(this.configuration);
            const transactions = toTransactions(apiDescriptions);
            this.transactionRunner.run(transactions, (runError) => {
                callback(runError, this.stats);
            });
        });
    }
}
exports.default = Dredd;
