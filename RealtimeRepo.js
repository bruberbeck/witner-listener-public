const admin = require('firebase-admin');

// Encapsulates a cache for a Firebase Realtime
// Database branch.
class RealtimeRepo {
  constructor(branchPath) {
    let that = this;
    this._path = branchPath;
    this._ref = admin.database().ref(branchPath)
    this._repo = new Map();

    this._ref.on('child_added', function(snap, prevChildKey) {
      that._repo.set(snap.key, snap.val());
    });

    this._ref.on('child_changed', function(snap, prevChildKey) {
      that._repo.set(snap.key, snap.val());
    });

    this._ref.on('child_removed', function(snap) {
      that._repo.delete(snap.key);
    });
  }

  get repo() {
    return this._repo;
  }
}

module.exports = RealtimeRepo;
