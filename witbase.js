'use strict';

const admin = require('firebase-admin');
const RealtimeRepo = require('./RealtimeRepo');
const WeetSpatialAnalyzer = require('./WeetSpatialAnalyzer');
const streamer = require('./streamer');

const witbase = (function () {
  // Paths.
  const configPath = '/config/';
  const tweetsPath = '/weets/tweets/';
  const witneetsPath = '/weets/witneets/';
  const witneetsRepliesTweetsPath = '/weets/replies/tweets/';
  const witneetsRepliesWitneetsPath = '/weets/replies/witneets/';
  const geofireWitneetsPath = '/weets/geofire/witneets/';
  
  // Warning messages.
  const CannotUpdateQualifiedStatusWithLowerPriority = 'You can not update this help request with a lower priority:';
  const PriorityHasChanged = 'Help request\'s priority level has changed:';
  const FoundALessCostlyHelpRequest = 'We have found a less costly help request:';

  // Fields.
  let _tweetsRef,
    _witneetsRef,
    _witneetsRepliesTweetsRef,
    _witneetsRepliesWitneetsRef,
    _config,
    _configChangeCallbacks,
    _replyTracks,
    _witneetsRepo,
    _weetSpatialAnalyzer;

  (function init() {
    _tweetsRef = admin.database().ref(tweetsPath);
    _witneetsRef = admin.database().ref(witneetsPath);
    _witneetsRepliesTweetsRef = admin.database().ref(witneetsRepliesTweetsPath);
    _witneetsRepliesWitneetsRef = admin.database().ref(witneetsRepliesWitneetsPath);
    _configChangeCallbacks = Object.create(null);
    admin.database().ref(configPath)
      .on('value', snap => {
        _config = snap.val();
        _replyTracks = _config.replyTracks;

        _mapConfig();
      });
    _witneetsRepo = new RealtimeRepo(witneetsPath);
    _weetSpatialAnalyzer = new WeetSpatialAnalyzer(_witneetsRepo);
  })();

  function _tweetHasLocation(tweet) {
    return tweet.geo || (tweet.place && tweet.place.place_type == 'poi');
  }

  function _getReplyTrack(tweet) {
    if (!_replyTracks)
      return null;

    let tags = tweet.entities.hashtags;
    if (!tags || tags.length == 0)
      return null;

    // We have tags...
    let i, tag, replyTag, topReplyTag = null;
    for (i = 0; i < tags.length; ++i) {
      tag = tags[i];
      replyTag = _config.replyTracks[tag.text];

      if (replyTag &&
        // We have a corresponding replyTrack tag.
        (!topReplyTag || replyTag.priority < topReplyTag.priority)) {
        // topReplyTag is empty or has lower priority.
        topReplyTag = replyTag;
      }
    }

    return topReplyTag;
  }

  function _addTweet(tweet) {
    let ref = _tweetsRef.child(tweet.id_str);
    tweet.key = ref.key;
    ref.set(tweet);
  }

  function _sendTweet(targetEet, postBody, callback) {
    let targetScreenName = targetEet.user.screenName || targetEet.user.screen_name,
      targetTweetId = targetEet.tweetId || targetEet.id_str;
      
     streamer.post(postBody, targetScreenName, targetTweetId,
        tweet => {
          if (callback) {
            callback(tweet);
          }
          else {
            console.log(`${postBody} Tweet sent to @${targetScreenName}`);
          }
        });
  }
  
  function _sendQuoteTweet(quotedEet, targetEet, tweetText) {
    let quoteScreenName = quotedEet.user.screenName || quotedEet.user.screen_name,
      quoteTweetId = quotedEet.tweetId || quotedEet.id_str,
      postBody = `https://twitter.com/${quoteScreenName}/status/${quoteTweetId}`;
      
    if (tweetText) {
      postBody = tweetText + " " + postBody;
    }
    
    _sendTweet(targetEet, postBody);
  }

  function _broadcastReply(repliedWitneet, replyTweet, tweetText) {
    let userId = replyTweet.user.id_str,
      screenName = replyTweet.user.screen_name,
      replyId = replyTweet.id_str,
      postBody = `https://twitter.com/${screenName}/status/${replyId}`;
      
      if (tweetText) {
        postBody = tweetText + " " + postBody;
      }

      _witneetsRepliesWitneetsRef.child(repliedWitneet.tweetId)
        .once('value', snap => {
          // 'snap.val()' is a reply id keys to reply witneets array,
		  // and it may be empty.
		  if (!snap.val()) {
			  return;
		  }
		  
          let witneets = Object.values(snap.val()),
			sentUsers = new Set();
		  // Notify latest tweets first.
          witneets.reverse().forEach(witneet => {
			let replyUserId = witneet.user.userId;
            if (replyUserId != userId && !sentUsers.has(replyUserId)) {
              _sendTweet(witneet, postBody);
			  sentUsers.add(replyUserId);
            }
          });
        });
  }
  
  function _sendMinimumCostWitneet(witneet, replyTweet, tweetText) {
    _sendQuoteTweet(witneet, replyTweet, tweetText)
  }

  function _addReplyToTweet(replyTweet) {
    let inReplyToId = replyTweet.in_reply_to_status_id_str;
    _witneetsRef.child(inReplyToId)
      // 'witneetSnap' is the Firebase nodular snapshot
      // for a witneet object.
      .once('value', witneetSnap => {
        // Is there an associted 'witneet' with this reply?
        if (!witneetSnap.exists()) {
          // There is not.
          // Just return.
          return;
        }

        _updateReplyStatsOfSnapshot(witneetSnap, replyTweet);
    });
  }

  // _addReplyToTweet performs two important operations:
  // 1. If the reply 'tweet' has accurate location information then,
  // 1.a. tries to find hazards on the default route and associates and quote
  // tweets a risk weight information with that route to the user of the
  // reply tweet.
  // 1.b. looks for help calls with lower priority tags and, if any,
  // quote tweets the closest of them to the user of the reply tweet.
  // 2. Updates the reply stats of the replied to witneet.
  function _updateReplyStatsOfSnapshot(witneetSnap, replyTweet) {
    // First, add this replyTweet to the 'replies' branch.
    _witneetsRepliesTweetsRef.child(`${witneetSnap.key}/${replyTweet.id_str}`)
      .set(replyTweet);

    // Now we are going to try to update the status of the 'witneet'
    // to which this tweet was a reply.

    // First, try to get a 'replyTrack' for this replyTweet.
    let prioTag = _getReplyTrack(replyTweet);

    // If there is one, update the 'qualified' members.
    if (prioTag) {
      let statusObj = {
        tag: prioTag.text,
        priority: prioTag.priority,
        tweetId: replyTweet.id_str,
        user: {
          userId: replyTweet.user.id_str,
          screenName: replyTweet.user.screen_name
        }
      };

      // First update the qualifiedReplies.
      witneetSnap.ref.child('replyStats/qualifiedReplies')
        .transaction(function (qIds) {
          qIds = qIds || [];
          qIds.push(statusObj);
          return qIds;
        });

      // And then, if this reply was top priority,
      // set this replyTweet as the 'currentQualifiedStatus.'
      let witneet = witneetSnap.val(),
        curStat = witneet.replyStats
          && witneet.replyStats.currentQualifiedStatus,
        curPrioTag = curStat && _replyTracks[curStat.tag],
        qualifiedReplies = witneet.replyStats
          && witneet.replyStats.qualifiedReplies;

      // And then, if this reply was top priority,
      // set this replyTweet as the 'currentQualifiedStatus.'
      witneetSnap.ref.child('replyStats')
          .transaction(function (replyStats) {
            let curStat = replyStats && replyStats.currentQualifiedStatus,
              curPrioTag = curStat && _replyTracks[curStat.tag],
              qualifiedReplies = replyStats && replyStats.qualifiedReplies;
              
            if (!curPrioTag
              // The lower its value the higher the priority is.
              ||  prioTag.priority < curPrioTag.priority
              // A user can cause an update to a qualified status,
              // if that user was the author of the status,
              // no matter if the new priority is lower than or equal
              // to the previous one.
              || statusObj.user.userId == curStat.user.userId) {
              // We are about to update a witneet's 'currentQualifiedStatus',
              // meaning that all users browsing our catalog will be
              // seeing the new priority coloring for this witneet.
              // In order to convey accurate status information,
              // we need to make sure that no other witneet reply of this user
              // shares the same qualification with this witneet reply.
              // Since, for instance, the same Help & Rescue unit cannot be simultaneously
              // assisting with two locations.
              // One exception is the 'completed' status and it identifies the
              // highest help priority (0).

              if (prioTag.priority !== 0) {
                // We have a not-completed priority.
                // Make sure to clear out this user's other replied witneets.
                _popUserPrevStatuses(witneetSnap.key, statusObj);
              }

              witneetSnap.ref.child('replyStats/currentQualifiedStatus')
                .transaction(function (status) {
                  return statusObj;
                });

              // Inform the previous qualified replies
              // about the new qualification status.
              if (qualifiedReplies && qualifiedReplies.length > 0) {
                _broadcastReply(witneet, replyTweet, PriorityHasChanged);
              }
              
              // Update replyStats.currentQualifiedStatus.
              replyStats.currentQualifiedStatus = statusObj;
            }
            else if (curPrioTag && prioTag.priority >= curPrioTag.priority) {
              // You cannot update a help request with a lower or same level
              // of priority.
              // Inform the user about this situation.
              _sendQuoteTweet(curStat, replyTweet, CannotUpdateQualifiedStatusWithLowerPriority);
            }
            
            return replyStats;
          });

      // Lastly, if this reply has location information attached to it
      // we are going to look for a witneet with a lower risk value
      // and with a lower priority so that help can be directed
      // where it is most possibly to reach in time.
      if (_tweetHasLocation(replyTweet)) {
        _weetSpatialAnalyzer.analyze(replyTweet, witneet, statusObj)
          .then(minCost => {
            if (minCost == null) {
              // There was no witneet with a less cost then this witneet.
              // And processing.
              return;
            }

            _sendMinimumCostWitneet(minCost.hazard.witneet, replyTweet, FoundALessCostlyHelpRequest);
          });
      }
    }
    else {
      // There is none. Just add it to the 'replies.'
      witneetSnap.ref.child("replyStats/replies")
        .transaction(function (ids) {
          ids = ids || [];
          ids.push(replyTweet.id_str);
          return ids;
        });
    }
  }

  function _popUserPrevStatuses(repliedToTweetId, statusObj) {
	// Check all witneets.
    for (let witneet of _witneetsRepo.repo.values()) {
      if (witneet.tweetId != repliedToTweetId
        && witneet.replyStats
        && witneet.replyStats.currentQualifiedStatus
        && witneet.replyStats.currentQualifiedStatus.user.userId === statusObj.user.userId) {
        _witneetsRef.child(witneet.tweetId)
          .transaction(function(witneet) {
            if (witneet.replyStats
              && witneet.replyStats.currentQualifiedStatus
              && witneet.replyStats.currentQualifiedStatus.user.userId === statusObj.user.userId) {
              delete witneet.replyStats.currentQualifiedStatus;
            }
						return witneet;
          });
      }
    }
  }

  function _mapConfig() {
    for (let prop in _configChangeCallbacks)
      _configChangeCallbacks[prop](_config);
  }

  // Assuming that every function attached to me will have a different
  // length.
  function _addConfigChangeListener(listener) {
    _configChangeCallbacks[listener.toString().length] = listener;
  }

  function _removeConfigChangeListener(listener) {
    delete _configChangeCallbacks[listener.toString().length];
  }

  return {
    addTweet: _addTweet,
    addReplyToTweet: _addReplyToTweet,
    addConfigChangeListener: _addConfigChangeListener,
    removeConfigChangeListener: _removeConfigChangeListener
  };
})();

module.exports = witbase;
