"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = __importDefault(require("util"));
var executionLogs = " ";
var temp = " ";
function hooksLog(logs = [], logger, content) {
    // Log to logger
    if (logger && typeof logger.hook === 'function') {
        logger.hook(content);
    }
    // Append to array of logs to allow further operations, e.g. send all hooks logs to Apiary
    logs.push({
        timestamp: Date.now(),
        content: typeof content === 'object' ? util_1.default.format(content) : `${content}`,
    });
    temp = content;
    retainLogs();
    return logs;
}
function retainLogs() {
    if (!(temp == null || temp == undefined)) {
        if (!executionLogs.includes('res did not satisfy it because')) {
            executionLogs = temp; // + executionLogs.trim();
        }
        else {
            var startIndex = temp.indexOf('endpoint');
            var endIndex = temp.indexOf('in your API spec');
            var alreadyLoggedTransaction = temp.substring((startIndex + 8), endIndex);
            if (!executionLogs.includes(alreadyLoggedTransaction.trim())) {
                executionLogs = " ";
                executionLogs = temp; // + executionLogs.trim();
            }
        }
    }
    else {
    }
    return executionLogs;
}
exports.default = hooksLog;
exports.default1 = retainLogs;
