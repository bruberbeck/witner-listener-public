const polylineEncoding = require('polyline-encoded');

// '_init' sets up global objects' prototypes for utility operations.
(function _init() {
  Array.prototype.last = function() {
    return this[this.length - 1];
  };
}());

class DirectionsHelpers {
  // Gets a google maps directions API request object.
  static getRequest(orgn, dest, departureTimeOffsetMinutes) {
    let inTime = Math.round((new Date().getTime()
      + departureTimeOffsetMinutes * 60 * 1000) / 1000);
    return {
      origin: orgn,
      destination: dest,
      departure_time: inTime,
      mode: 'driving',
      avoid: ['tolls', 'ferries'],
      traffic_model: 'pessimistic',
      optimize: true,
    };
  }

  static getStepPath(step) {
    return {
      distance: step.distance.value,
      polyline: polylineEncoding.decode(step.polyline.points)
    };
  }

  // Each 'directions' route consists of one or more
  // 'leg's. 'getStepPath' calculates the total distance
  // and accumulates all the points forming that leg as
  // LatLng objects and returns them wrapped in an object.
  static getLegPath(leg) {
    let stepPaths = leg.steps.map(this.getStepPath),
      totalDistance = stepPaths.reduce((acmltr, sp) => {
        return acmltr + sp.distance
      }, 0),
      polyline = stepPaths.reduce((acmltr, sp) => {
        let sliceLen = sp.polyline.length - 1;
        // Exclude step end points from overall polyline,
        // for start points of each next step already is
        // the end point of the former step.
        acmltr.push(... (sp.polyline.slice(0, sliceLen)));
        return acmltr;
      }, []);
    // We need to add last step's last end point by hand
    // for we have skipped it just above.
    polyline.push(stepPaths.last().polyline.last());

    return {
      distance: totalDistance,
      // polyline is an array of LatLngs.
      polyline: polyline,
      stepPaths: stepPaths
    };
  }

  // Generates query paths for each leg path of a direction
  // route and maps those query parameters to the 'getLegPath'
  // function.
  static getLegPaths(directions) {
    if (directions.routes.length == 0) {
      return null;
    }

    return directions.routes[0].legs
      .map(leg => this.getLegPath(leg));
  }

  static getSections(directions) {
    let sections = [];
    for (let lp of DirectionsHelpers.getLegPaths(directions)) {
      for (let sp of lp.stepPaths) {
        sections.push(sp.polyline);
      }
    }
    return sections ;
  }
}

module.exports = DirectionsHelpers;
