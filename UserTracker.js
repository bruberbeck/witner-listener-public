'use strict';

const UserTracker = (function () {
    function _userTracker(users) {
      this._follows = {};

      if (typeof users[Symbol.iterator] === 'function') {
        for (let usr of users) {
          this._follows[usr] = true;
        }
      }
    };

    function _addUser(userId) {
      this._follows[userId] = true;
    };

    function _userExists(userId) {
      return this._follows[userId] != undefined;
    };

    function _getFollows() {
      return Object.keys(this._follows).join(',');
    };

    let _prototype = {
      constructor: _userTracker,
      addUser: _addUser,
      userExists: _userExists,
      getFollows: _getFollows
    };

    _userTracker.prototype = _prototype;
    return _userTracker;
  }());

module.exports = UserTracker;
