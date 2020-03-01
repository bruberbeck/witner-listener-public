const admin = require('firebase-admin');
const GeoFire = require('geofire').GeoFire;
const GeoFireBuffer = require('../GeoFireBuffer');

const polylineTestSections = [ [
  [40.93117512985895,28.91240901924766],
  [40.931177690208465,28.91300352894075],
  [40.93118024750468,28.91359803867988]
] ];

const polylineTestInPoints = [
  { key: '1001', location: [40.931172566456134, 28.91181450960073] },
  { key: '1002', location: [40.93118280174758, 28.914192548465053] },
  { key: '1003', location: [40.93072597221689, 28.91240901924766] },
  { key: '1004', location: [40.931624287501, 28.91240901924766] },
  { key: '1005', location: [40.9307285325664, 28.91300352894075] },
  { key: '1006', location: [40.93162684785052, 28.91300352894075] },
  { key: '1007', location: [40.93073108986261, 28.91359803867988] },
  { key: '1008', location: [40.93162940514674, 28.91359803867988] },
  { key: '1009', location: [40.93072608430029, 28.912706278881274] },
  { key: '1010', location: [40.9316243995844, 28.912706278881274] },
  { key: '1011', location: [40.93072864388646, 28.91330078858641] },
  { key: '1012', location: [40.931626959170586, 28.91330078858641] },
];

const polylineTestOutPoints = [
  { key: '100', location: [40.931181021043066, 28.911695638623314] },
  { key: '101', location: [40.93063614068847, 28.91240901924766] },
  { key: '102', location: [40.93171411902942, 28.91240901924766] },
  { key: '103', location: [40.93063870103799, 28.91300352894075] },
  { key: '104', location: [40.93171667937893, 28.91300352894075] },
  { key: '105', location: [40.93118051155839, 28.91431146185971] },
  { key: '106', location: [40.930641258334205, 28.913598038679766] },
  { key: '107', location: [40.93171923667516, 28.913598038679766] },
];

const pointTestSections = [ [
  [40.931177690208465,28.91300352894075],
] ];

const pointTestInPoints = [
  { key: '2001', location: [ 40.93162684785054, 28.91300352894075 ] },
  { key: '2002', location: [ 40.93118048007506, 28.913598036848498 ] },
  { key: '2003', location: [ 40.93072853256641, 28.91300352894075 ] },
  { key: '2004', location: [ 40.931185169732466, 28.91240909197927 ] },
];

const pointTestOutPoints = [
  { key: '201', location: [ 40.93163175904739, 28.91240904105416 ] },
  { key: '202', location: [ 40.93163220590688, 28.91359801006729 ] },
  { key: '203', location: [ 40.9307334436745, 28.91240904913559 ] },
  { key: '204', location: [ 40.93073389052591, 28.913598001986202 ] },
];

class Tests {
  static bufferTest(testSections, testInPoints, testOutPoints) {
    let firebaseRef = admin.database().ref('/').push(),
      geoFireRef = new GeoFire(firebaseRef),
      gfb = new GeoFireBuffer(geoFireRef);

    testInPoints.forEach(tip => geoFireRef.set(tip.key, tip.location));
    let testInPointsSet = new Set();
    testInPoints.forEach(tip => testInPointsSet.add(tip.key));

    testOutPoints.forEach(top => geoFireRef.set(top.key, top.location));
    let testOutPointsSet = new Set();
    testOutPoints.forEach(top => testOutPointsSet.add(top.key));

    gfb.analyze(testSections, 50)
      .then(results => {
        for (let key of results[0].queryResult.keys()) {
          testInPointsSet.delete(key);
          testOutPointsSet.delete(key);
        }
      })
      .then(() => {
        if (testInPointsSet.size != 0) {
          throw new Error('Not all points are discovered by the linear buffer.');
        }
        if (testOutPointsSet.size != testOutPoints.length) {
          throw new Error('Linear buffer calculates found wrong points.');
        }
        console.log('Test is successful.');
      })
      .then(() => {
        // Clean up.
        firebaseRef.set(null);
      });
  }
}

(function run() {
  // Point test.
  Tests.bufferTest(pointTestSections, pointTestInPoints, pointTestOutPoints);

  // Polyline test.
  Tests.bufferTest(polylineTestSections, polylineTestInPoints, polylineTestOutPoints);
}());
