const twitter = require('twitter');
const UserTracker = require('./UserTracker');

const streamer = (function () {
  let _twitterClient,
    _onlineStream = null,
    _tracksObj,
    _follows = new UserTracker([ '1163451670266822659', '845986747637006336', '1163452481571119105' ]),
    _tweetCallback,
    _replyCallback;

  // Makes sure that a tweet is a hashtag match with '_tracks'
  // in order to differentiate it from help response (reply) tweets.
  function _matchAgainstTracks(event) {
    if (!event.entities || !event.entities.hashtags)
      return false;

    let eventTracks = event.entities.hashtags
      .map(tag => tag.text.toLowerCase())
      .sort();

    return eventTracks.equalsTo(_tracksObj.tracksLowerCase);
  }

  function _getNewTwitterClient() {
    return new twitter({
      consumer_key: '',
      consumer_secret: '',
      access_token_key: '',
      access_token_secret: '' });
  }

  function _streamError(error) {
    console.error(`error: ${error}`);
  }

  function _getStreamObj(track, follows) {
    let streamObj = {};
    if (typeof track == 'string') {
      streamObj.track = track;
    }
    if (typeof follows == 'string' && follows.length > 0) {
      streamObj.follow = follows;
    }

    console.log(streamObj);
    return streamObj;
  }

  // 'tracks' is an array of hashtags that we are aiming to track.
  function _getTracksObj(tracks) {
    if (!tracks || tracks.length == 0)
      return [];

    let saniTracks = [],
      saniTrack;
    for (let i = 0; i < tracks.length; ++i) {
      saniTrack = tracks[i].trim();
      if (saniTrack)
        saniTracks.push(saniTrack);
    }
    saniTracks.sort();

    return {
      // 'tracks' is the array of sanitized hashtags.
      tracks: saniTracks,
      tracksLowerCase: saniTracks.map(tr => tr.toLowerCase()),
      // 'tracksStr' is the saniTracks that we are going to use to check
      // incoming tweets' hashtags against.
      tracksStr: saniTracks.toString(),
      // 'track' is the track string that we are going to use for
      // tweet streaming.
      track: saniTracks.join(' '),
    };
  }

  function _startStream() {
    console.log('Starting stream...');
    let streamObj = _getStreamObj(_tracksObj.track, _follows.getFollows());
    _onlineStream = _twitterClient.stream('statuses/filter', streamObj);
    _onlineStream.on('data', function (event) {
      if (event) {
        if (_matchAgainstTracks(event)) {
          try {
            _tweetCallback(event);
          }
          catch (err) {
            console.error(err);
          }

          // If the user who sent this tweet isn't already being followed for
          // a possible reply, then add her to the streaming parameter.
          let userId = event.user.id_str;
          if (!_follows.userExists(userId)) {
            _follows.addUser(userId);
            _recycleStream();
          }
        }
        // If a tweet has its 'in_reply_to_status_id_str' set,
        // this means that this tweet was generated as a response
        // to a help request tweet.
        else if (event.in_reply_to_status_id_str) {
          try {
            _replyCallback(event);
          }
          catch (err) {
            console.error(err);
          }
        }
      }
      else {
          console.error('Could not insert tweet to the DB:');
          console.error('event: ' + event);
          // If connection was cut due to timeout or inactivity,
          // just restart streaming.
          // A better approach would be to keep redundant backup
          // connections for not missing out any possible tweets.
          // One can find more information about Twitter
          // streaming strategies on the web and Twitter Dev Docs.
          if (error.code && error.code == 'ECONNRESET') {
             _recycleStream();
          }
       }
    });
    _onlineStream.on('error', _streamError);
  }

  function _stopStream() {
    console.log('Stopping stream...');
    if (_onlineStream) {
      _onlineStream.destroy();
      _onlineStream = null;
      console.log('Stream destroyed.');
    }
    else {
      console.log('Stream already destroyed.');
    }
  }

  function _recycleStream() {
    console.log('Recycling stream...');
    _stopStream();
    _startStream();
  }

  // tracks: An array of hashtag keywords against which tweets will be
  // streamed. Warning: Multiple tracks means that only tweets including each
  // individual 'track' will be streamed.
  // tweetCallback: A function with a tracked tweet object as its only parameter.
  // replyCallback: A function with a tracked reply tweet object as its only parameter.
  function _stream(tracks, tweetCallback, replyCallback) {
    if (!Array.isArray(tracks) || tracks.length == 0)
      throw '"tracks" needs to be a non-empty array.';

    _tracksObj = _getTracksObj(tracks);
    _tweetCallback = tweetCallback;
    _replyCallback = replyCallback;

    if (_onlineStream) {
      _recycleStream();
    }
    else {
      _twitterClient = _getNewTwitterClient();
      _startStream();
    }
  }

  // status: The text body of the tweet that will be posted.
  // screenName: The 'user.screen_name' of a tweet object. This parameter
  // is required for the 'replyStatusId' parameter to be meaningful
  // and needs to be identical to the user.screen_name of the tweet
  // with id 'replyStatusId.'
  // tweetCallback: A callback taking the tweet object as its sole parameter.
  function _post(status, screenName, replyStatusId, tweetCallback) {
    if (screenName) {
      status = `@${screenName} ${status}`;
    }

    let postObj = { status: status };
    if (screenName && replyStatusId) {
      postObj.in_reply_to_status_id = replyStatusId;
    }

    // According to Twitter POST statuses/update doc,
    // (https://developer.twitter.com/en/docs/tweets/post-and-engage/api-reference/post-statuses-update),
    // a status should be posted with a username (screenName) so that
    // it can be posted as a reply to a previously sent tweet by
    // that user.
    _twitterClient.post('statuses/update', postObj, function(error, tweet, response) {
      if (error) {
        console.error(error);
        return;
      }

      if (typeof tweetCallback == 'function') {
        tweetCallback(tweet);
      }
    });
  }

  return {
    stream: _stream,
    post: _post,
    stop: _stopStream
  };
})();

module.exports = streamer;
