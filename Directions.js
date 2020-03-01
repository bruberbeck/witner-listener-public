const DirectionsHelpers = require('./DirectionsHelpers');
const googleMaps = require('@google/maps');
const googleMapsClient = googleMaps.createClient({
  key: 'AIzaSyDsTFsXmZcpoOjZQjyTs_ULsA86dGdLKn0',
  Promise: Promise
});

// Wraps calls to the Google Maps' directions API.
class Directions {
  // 'departureTimeOffset' designates for which future time the
  // Google Maps directions calls should be made.
  // 'departure_time' option needs to be set on a directions
  // google maps request object for only if it is supplied
  // then a 'traffic_model' can be specified on the request
  // object.
  // 'departureTimeOffset' is in minutes and should be a positive
  // integer value.
  constructor(departureTimeOffset) {
    if (!Number.isInteger(departureTimeOffset)
      || departureTimeOffset < 0) {
      throw new Error('Invalid departureTimeOffset value.' +
        ' departureTimeOffset needs to be a positive integer value.');
    }

    this._departureTimeOffset = departureTimeOffset;
  }

  get(orgn, dstn) {
    if (typeof orgn != 'string' || typeof dstn != 'string') {
      throw new Error('origin and destination need to be strings.');
    }

    return googleMapsClient
      .directions(DirectionsHelpers.getRequest(orgn, dstn, this._departureTimeOffset))
      .asPromise();
  }
}

module.exports = Directions;
