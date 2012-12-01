/**
 * An AppWorker is responsible for:
 *
 * - Launching a Shiny application with the proper user/group permissions
 * - Ensuring that stderr is written to the specified path
 * - Returning a promise that resolves when the worker process exits
 */

var child_process = require('child_process');
var fs = require('fs');
var util = require('util');
var Q = require('q');
var _ = require('underscore');

var rprog = process.env.R || 'R';
var scriptPath = __dirname + '/../../R/SockJSAdapter.R';

/**
 * Begins launching the worker; returns a promise that resolves when
 * the worker is constructed (doesn't necessarily mean the process has
 * actually begun running though).
 *
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {Number} listenPort - The port number that the Shiny app should use.
 * @param {String} logFilePath - The file path to write stderr to.
 */
function launchWorker_p(appSpec, listenPort, logFilePath) {
  
  // Open the log file asynchronously, then create the worker

  return Q.nfcall(fs.open, logFilePath, 'a', 0666).then(function(logStream) {

    // Create the worker; when it exits (or fails to start), close
    // the logStream.
    var worker = new AppWorker(appSpec, listenPort, logStream);
    worker.getExit_p().fin(function() {
      logStream.end();
    });

    return worker;
  });
};
exports.launchWorker_p = launchWorker_p;

/**
 * Like launchWorker_p, but the promise it returns doesn't resolve until
 * the worker process exits.
 */
function runWorker_p(appSpec, listenPort, logFilePath) {
  return launchWorker_p(appSpec, listenPort, logFilePath).then(function(worker) {
    return worker.getExit_p();
  });
};
exports.runWorker_p = runWorker_p;

/**
 * An AppWorker models a single R process that is running a Shiny app.
 *
 * @constructor
 * @param {AppSpec} appSpec - Contains the basic details about the app to
 *   launch
 * @param {Number} listenPort - The port number that the Shiny app should use.
 * @param {Stream} logStream - The stream to dump stderr to.
 */
var AppWorker = function(appSpec, listenPort, logStream) {
  this.$dfEnded = Q.defer();
  var self = this;

  try {
    // Run R
    if (!appSpec.runAs)
      throw new Exception("No user specified");

    if (!appSpec.appDir)
      throw new Exception("No app directory specified");

    var args = [
      "--no-save",
      "-f",
      scriptPath
    ];

    var env = _.clone(process.env);
    env.SHINY_PORT = '' + listenPort;
    env.SHINY_APP = '.';
    if (appSpec.settings.gaTrackingId)
      env.SHINY_GAID = appSpec.settings.gaTrackingId;

    this.$proc = child_process.spawn(rprog, args, {
      env: env,
      cwd: appSpec.appDir,
      stdio: ['ignore', 'ignore', logStream]
    });
    this.$proc.on('exit', function(code, signal) {
      self.$dfEnded.resolve({code: code, signal: signal});
    });
  }
  catch (e) {
    this.$dfEnded.reject(e);
  }
};

(function() {

  /**
   * Returns a promise that is resolved when the process exits.
   * If the process terminated normally, code is the final exit
   * code of the process, otherwise null. If the process
   * terminated due to receipt of a signal, signal is the string
   * name of the signal, otherwise null.
   */
  this.getExit_p = function() {
    return this.$dfEnded.promise;
  };

}).call(AppWorker.prototype);