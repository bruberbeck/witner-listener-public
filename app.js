'use strict';

//
//
// #requires

const init = require('./init'); // Initialize the program.
const streamer = require('./streamer');
const witbase = require('./witbase');

// '_init' sets up global objects' prototypes for utility operations.
(function _init() {
  Array.prototype.equalsTo = function(arr) {
    if (!Array.isArray(arr) || this.length != arr.length)
      return false;

    for (let i = 0; i < this.length; ++i) {
      if (this[i] !== arr[i])
        return false;
    }

    return true;
  };
}());

//
//
// #app

(function _app() {
  let _streaming = false,
    _tracks = [];

  witbase.addConfigChangeListener((configObj) => {
    if (configObj
      && configObj.isOn
      && configObj.tracks
      && !_tracks.equalsTo(configObj.tracks)) {
      streamer.stream(configObj.tracks, witbase.addTweet,
        witbase.addReplyToTweet);
      _streaming = true;
      _tracks = configObj.tracks;
    }
    else if (!configObj || !configObj.isOn) {
      if (_streaming) {
        streamer.stop();
        _streaming = false;
      }
    }
  });
}());
