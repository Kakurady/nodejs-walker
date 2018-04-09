module.exports = Walker

var path = require('path')
  , fs = require('fs')
  , util = require('util')
  , EventEmitter = require('events').EventEmitter
  , makeError = require('makeerror')
  , p_defer = require('p-defer')
const debugDependencies = false;
const lstatAsync = util.promisify(fs.lstat);
const readdirAsync = util.promisify(fs.readdir);
/**
 * To walk a directory. It's complicated (but it's async, so it must be fast).
 *
 * @param root {String} the directory to start with
 */
function Walker(root) {
  if (!(this instanceof Walker)) return new Walker(root)
  EventEmitter.call(this)
  this._pending = 0
  this._filterDir = function() { return true }
  this.go(root)
}
util.inherits(Walker, EventEmitter)

/**
 * Errors of this type are thrown when the type of a file could not be
 * determined.
 */
var UnknownFileTypeError = Walker.UnknownFileTypeError = makeError(
  'UnknownFileTypeError',
  'The type of this file could not be determined.'
)

/**
 * Setup a function to filter out directory entries.
 *
 * @param fn {Function} a function that will be given a directory name, which
 * if returns true will include the directory and it's children
 */
Walker.prototype.filterDir = function(fn) {
  this._filterDir = fn
  return this
}

/**
 * Process a file or directory.
 */
Walker.prototype.go = async function(entry, waitBeforeEmit = Promise.resolve("")) {
  var that = this
  this._pending++

  try {
    that.emit("visit", entry);
    let stat = await lstatAsync(entry);
    if (stat.isDirectory()) {
      if (!that._filterDir(entry, stat)) {
        that.doneOne();
      } else {
        try {
          let files = await readdirAsync(entry);
          if(debugDependencies){console.log(entry, "rd");}
          files.sort((a,b)=>a.localeCompare(b));

          let selfHasFinishedEmitDefer = p_defer();
          // let the file go         
          
          let nextpromise = selfHasFinishedEmitDefer.promise;
          let allPromises = files.map((part)=>
          {
            nextpromise = that.go(path.join(entry, part), nextpromise);
            return nextpromise;
          })
          
          let prevfile = await waitBeforeEmit;
          if(debugDependencies){console.log(entry, "<=", prevfile);}
          that.emit('entry', entry, stat)
          that.emit('dir', entry, stat)
          selfHasFinishedEmitDefer.resolve(debugDependencies ? entry: null);

          let lastfile = await nextpromise;
          if(debugDependencies){console.log(entry, "<~", lastfile);}
          await Promise.all(allPromises);
          that.doneOne()
        } catch (er) {
          that.emit('error', er, entry, stat)
          let prevfile = await waitBeforeEmit;
          if(debugDependencies){console.log(entry, "!!", prevfile);}
          that.doneOne()
        }
      }
    } else {
      let prevfile = await waitBeforeEmit;
      if(debugDependencies){console.log(entry, "<-", prevfile);}
      if (stat.isSymbolicLink()) {
        that.emit('entry', entry, stat)
        that.emit('symlink', entry, stat)
        that.doneOne()
      } else if (stat.isBlockDevice()) {
        that.emit('entry', entry, stat)
        that.emit('blockDevice', entry, stat)
        that.doneOne()
      } else if (stat.isCharacterDevice()) {
        that.emit('entry', entry, stat)
        that.emit('characterDevice', entry, stat)
        that.doneOne()
      } else if (stat.isFIFO()) {
        that.emit('entry', entry, stat)
        that.emit('fifo', entry, stat)
        that.doneOne()
      } else if (stat.isSocket()) {
        that.emit('entry', entry, stat)
        that.emit('socket', entry, stat)
        that.doneOne()
      } else if (stat.isFile()) {
        that.emit('entry', entry, stat)
        that.emit('file', entry, stat)
        that.doneOne()
      } else {
        that.emit('error', UnknownFileTypeError(), entry, stat)
        that.doneOne()
      }
    }
  } catch (er) {
    that.emit('error', er, entry, new fs.Stats())
    let prevfile = await waitBeforeEmit;
    if(debugDependencies){console.log(entry, "!!", prevfile);}
    that.doneOne()
  }

  return debugDependencies ? entry: null;
}

Walker.prototype.doneOne = function() {
  if (--this._pending === 0) this.emit('end')
  return this
}
