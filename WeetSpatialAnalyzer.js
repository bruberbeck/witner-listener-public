const DirectionsHelpers = require('./DirectionsHelpers');
const Directions = require('./Directions');
const FireBuffer = require('fire-buffer');
const Geometry = require('spherical-geometry-js');
const Admin = require('firebase-admin');
const GeoFire = require('geofire').GeoFire;
const polylineEncoding = require('polyline-encoded');

const GeofireWitneetsPath = '/weets/geofire/witneets/';
const DepartureTimeOffset = 60;
const BufferRadius = 100;
const AnalysisRangeFactor = 3;

const MillisecondToMinuteCoefficient = 1000 * 60;
const MillisecondToHoursCoefficient = 1000 * 60 * 60;

// Route cost normalization parameters.
const LikertHighestScale = 5;
const LengthImportance = 1;
const TimeImportance = 1;
const HazardImportance = 4;
const TotalImportance = HazardImportance + TimeImportance + LengthImportance;
const LengthWeight = LengthImportance / TotalImportance;
const TimeWeight = TimeImportance / TotalImportance;
const HazardWeight = HazardImportance / TotalImportance;

// Setup prototypes of global objects for ease of use.
(function _init() {
  Math.maxOf = (arr, selectVal = val => val) => {
    return arr.reduce((a, b) => selectVal(a) > selectVal(b) ? a : b);
  };

  Math.minOf = (arr, selectVal = val => val) => {
    return arr.reduce((a, b) => selectVal(a) < selectVal(b) ? a : b);
  };
}());

class Helpers {
  static tweetHasLocation(tweet) {
    return tweet.geo || (tweet.place && tweet.place.place_type == 'poi');
  }

  static getTweetCoordinates(tweet) {
    if (tweet.geo) {
      return tweet.geo.coordinates;
    }
    let coords = tweet.place.bounding_box.coordinates[0][0];
    return [ coords[1], coords[0] ];
  }

  static getWitneetCoordinates(witneet) {
    return witneet.coordinates || witneet.poi.coordinates;
  }

  static getTweetTime(tweet) {
    return Number.parseInt(tweet.timestamp_ms);
  }

  static millisecondsToMinutes(time) {
    return time / MillisecondToMinuteCoefficient;
  }
  
  static millisecondsToHours(time) {
    return time / MillisecondToHoursCoefficient;
  }
}

class WeetSpatialAnalyzer {
  // realtimeWitneetRepo holds a map of all the registered witneets.
  // enableRangeConstraint controls filtering out of potential
  // candidate witneets which lie outside analysisRangeFactor
  // times the distance between replyTweets and their replied witneets,
  // taking replyTweets' location as the center of a circular
  // boundary.
  constructor(realtimeWitneetRepo, enableRangeConstraint = false) {
    this._witneetRepo = realtimeWitneetRepo;
    this._directions = new Directions(DepartureTimeOffset);
    this._geoFireRef = new GeoFire(Admin.database().ref(GeofireWitneetsPath));
    this._fireBuffer = new FireBuffer(this._geoFireRef);
    this._enableRangeConstraint = enableRangeConstraint;

    // for (let i = 0; i < 32; ++i) {
    //   this._geoFireRef.set((i * 100).toString(), [ 40.97827, 29.06840 ]);
    // }
    //
    // for (let i = 0; i < 24; ++i) {
    //   this._geoFireRef.set((i * 1000).toString(), [ 40.974855, 29.074265 ]);
    // }
    //
    // for (let i = 0; i < 16; ++i) {
    //   this._geoFireRef.set((i * 10).toString(), [ 40.98243, 29.06198 ]);
    // }
  }

  // analysisRangeFactor is the factor of how farther compared to destination
  // witneet, the other witneets in the realtimeWitneetRepo should be taken
  // into account. For instance, if analysisRangeFactor is 1.5, while analyzing
  // other witneets for their risk factors, witneets with 1.5 the distance
  // from a replyTweet to its witneet will be taken into account.
  static get analysisRangeFactor() { return AnalysisRangeFactor; }

  static get bufferRadius() { return BufferRadius; }

  static get departureTimeOffset() { return DepartureTimeOffset; }

  // Gets the candidate witneets excluding the witneet we are analyzing against.
  getCandidates(replyTweet, witneet, priority) {
    // First calculate the distance from the replyTweet to its replied witneet.
    let replyLocation = Helpers.getTweetCoordinates(replyTweet),
      witneetLocation = Helpers.getWitneetCoordinates(witneet),
      range = Geometry.computeDistanceBetween(replyLocation, witneetLocation)
        * AnalysisRangeFactor;

    return [... this._witneetRepo.repo.values()].filter(wtnt => {
      if (witneet.tweetId == wtnt.tweetId) {
        return false;
      }

      if (wtnt.replyStats
        && wtnt.replyStats.currentQualifiedStatus
        && wtnt.replyStats.currentQualifiedStatus.priority >= priority) {
        // If someone else is already working with this witneet disqualify it.
        return false;
      }

      if (!this._enableRangeConstraint) {
        return true;
      }

      // Eligible witneet. Just test its distance.
      let wtntLocation = Helpers.getWitneetCoordinates(wtnt);
      return Geometry.computeDistanceBetween(replyLocation, wtntLocation)
        < range;
    });
  }

  getHazard(orgn, wtnt) {
    let dstn = Helpers.getWitneetCoordinates(wtnt),
      that = this;
    return this._directions.get(orgn.toString(), dstn.toString())
      .then(function(response) {
        let sections = DirectionsHelpers.getSections(response.json);
        return that._fireBuffer.analyze(sections, BufferRadius);
      })
      .then(results => {
		
		console.log();		
		console.log();
		console.log(`tweetId | tweetText: ${wtnt.tweetId} | ${wtnt.text}`);
		console.log('---------');
		  
        // First get total distance.
        let totalDistance = results.reduce((acum, res) => {
            return acum + res.querySection.distance;
          }, 0);
		  
		console.log(`totalDistance: ${totalDistance}`); 
		console.log('sectionDistance | sectionMultiplier | hazardCount | sectionHazard | sectionEncoded');
		console.log('---------');

        // Then weight every leg's tweet count proportional to its distance
        // ratio.
        // See 'RouteCheckr: Personalized multicriteria routing for mobility
        // impaired pedestrians' equation 4.6 for details.
        let totalHazard = results.reduce((acum, res) => {
            let multiplier = res.querySection.distance / totalDistance;

            if (res.queryResult.has(wtnt.tweetId)) {
              // Remove our hazard calculation target's id
              // from the list of found ids.
              res.queryResult.delete(wtnt.tweetId);
            }
			
			let hazard = multiplier * res.queryResult.size;
			
			console.log(`${res.querySection.distance} | ${multiplier} | ${res.queryResult.size} | ${hazard} | ${polylineEncoding.encode(res.querySection.queryPolyline)}`);

            return acum + hazard;
          }, 0);
		 
		console.log('---------');
		console.log(`totalHazard: ${totalHazard}`);
		console.log('---------');
		console.log();

        return {
          totalDistance: totalDistance,
          totalHazard: totalHazard,
        };
      });
  }

  // Performs buffer analysis on all the witneet locations
  // with a lower response priority then the replied to witneet,
  // compares those risk values against the one of the replied witneet,
  // and, selects the lowest one and suggests it the user of the
  // replyTweet through quoting.
  analyze(replyTweet, witneet, statusObj) {
    let candidates = this.getCandidates(replyTweet, witneet, statusObj.priority),
      orgn = Helpers.getTweetCoordinates(replyTweet);

    console.log();
    console.log('*********');
    console.log('*********');
    console.log('*********');
    console.log();
    console.log(`Starting new risk analysis (${new Date()})`);
    console.log();
    console.log('Hazard parameters:');
    console.log();

    if (candidates.length == 0) {
      // We don't have any candidates. Just return null.
      return null;
    }

    // Push the current witneet to the candidates so that a hazard value is
    // calculated for it too.
    candidates.push(witneet);

    // Calculate risks.
    let that = this;
    let safetyPromises = candidates.map(wtnt => {
      return that.getHazard(orgn, wtnt)
        .then(hazard => {
          hazard.witneet = wtnt;
          return hazard;
        });
    });

    // Return the candidate witneet with lowest associated risk,
    // or null.
    return Promise.all(safetyPromises)
      .then(hazards => {
        // Actual path cost calculations.
        // See 'RouteCheckr: Personalized multicriteria routing for mobility
        // impaired pedestrians' equation 4.6 for details.

        console.log('');
        console.log('*********');
        console.log('');
        console.log('Calculating risks.');
        console.log('');
        console.log('Reference parameters:');
        console.log('');
        console.log(`LengthWeight: ${LengthWeight}`);
        console.log(`TimeWeight: ${TimeWeight}`);
        console.log(`HazardWeight: ${HazardWeight}`);
        console.log('');

        // Find the longest distance for length cost calculation.
        let maxDistance = Math.maxOf(hazards.map(hzrd => hzrd.totalDistance));
        console.log(`maxDistance (meters): ${maxDistance}`);

        // Find the time epoch against which we will calculate time costs.
        let timeEpoch = Helpers.getTweetTime(replyTweet),
        // Find the longest time since time epoch
          maxTime = Helpers.millisecondsToHours(Math.maxOf(
            hazards.map(hzrd => {
              hzrd.totalTime = timeEpoch - hzrd.witneet.twitterTimeStamp;
              return hzrd.totalTime;
            })));

        console.log(`maxTime (hours): ${maxTime}`);
        console.log();
        console.log('*********');

        // Then calculate costs.

        // hazard layout:
        // {
        //  totalDistance: totalDistance,
        //  totalHazard: totalHazard,
        //  witneet: witneet
        // }
        let costs = hazards.map(hzrd => {
            let lengthCost = hzrd.totalDistance / maxDistance
                * LikertHighestScale * LengthWeight,
              totalTime = Helpers.millisecondsToHours(timeEpoch - hzrd.witneet.twitterTimeStamp),
              timeCost = totalTime / maxTime * LikertHighestScale * TimeWeight,
              hazardCost = hzrd.totalHazard * HazardWeight;

            console.log();
            console.log(`tweetId | tweetText: ${hzrd.witneet.tweetId} | ${hzrd.witneet.text}`);
            console.log();
            console.log('totalDistance: ' + hzrd.totalDistance);
            console.log('totalTime: ' + totalTime);
            console.log('totalHazard: ' + hzrd.totalHazard);
            console.log();
            console.log('lengthCost: ' + lengthCost);
            console.log('timeCost: ' + timeCost);
            console.log('hazardCost: ' + hazardCost);
            console.log();
            console.log(`totalCost: ${lengthCost + hazardCost + timeCost}`);
            console.log();
            console.log('*********');

            return {
              cost: lengthCost + hazardCost + timeCost,
              hazard: hzrd
            }
          }),
          // Get min cost.
          minCost = Math.minOf(costs, cost => cost.cost);

          console.log();
          console.log('minCost: ' + JSON.stringify(minCost));
          console.log();
          console.log('*********');
          console.log('*********');
          console.log('*********');
          console.log();

          if (minCost.hazard.witneet.tweetId != witneet.tweetId) {
            // There exists a cheaper alternative for the user of the replyTweet
            // to attend to.
            // Return it.
            return minCost;
          }
          // The least costly alternative for the  user of the replyTweet
          // to attend to is this witneet itself.
          // Return null;
          return null;
      });
  }
}

module.exports = WeetSpatialAnalyzer;
