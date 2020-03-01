// Init.js performs app wide initializations and should be required
// as the first statement of the app.

const admin = require('firebase-admin');

// Firebase connection parameters.
const dbUrl = 'https://witner-4de44.firebaseio.com/';
const serviceAccount = require('./serviceAccountKey.json');

(function _init() {
  // Initialize Firebase.
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: dbUrl
  });
}());

module.exports = {};
