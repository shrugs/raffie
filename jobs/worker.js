/*jshint -W083 */
var config = require('../config/config');
var db = require('mongoskin').db('mongodb://raffie:' + config.DB_PASS + '@localhost:27017/raffie');
var venmo = require('../integrations/venmo');
var Q = require('q');

var active = true;


function getNextNonce() {
  // returns most recent DB nonce + 1
  var deferred = Q.defer();
  db.collection('counters').findOne({
    _id: 'nonce'
  }, function(err, result) {
    db.collection('counters').update({
      _id: 'nonce',
    }, {
      $inc: {
        seq: 1
      }
    }, function() {
      deferred.resolve(result.seq + 1);
    });
  });

  return deferred.promise;
}

function getNextBucket() {
  var deferred = Q.defer();
  db.collection('buckets').find({
    pot: {
      $gte: config.USERS_PER_POT
    },
    completed: false
  }).sort({
    nonce: 1
  }).limit(1).toArray(function(err, result) {
    if (err) {
      deferred.reject(err);
    } else {
      if (result.length === 0) {
        deferred.reject(true);
      } else {
        deferred.resolve(result[0]);
      }
    }
  });

  return deferred.promise;
}

function createBucketWithUser(user) {
  var deferred = Q.defer();

  getNextNonce().then(function(nonce) {
    db.collection('buckets').insert({
      pot: 1,
      users: [user],
      nonce: nonce,
      completed: false
    }, deferred.resolve);
  });

  return deferred.promise;
}

function addUserToBucket(bucket, user) {
  // bucket available, add
  var deferred = Q.defer();
  console.log('adding user to bucket', bucket._id);
  db.collection('buckets').update({
    _id: bucket._id
  }, {
    $push: {
      users: user
    },
    $set: {
      pot: bucket.pot + 1
    }
  }, deferred.resolve);

  return deferred.promise;
}

function addUserToNextBucket(user) {

  // find the lowest nonce bucket that the user is not a part of
  // and that user to the bucket and add 1 to the pot
  // if not exists, create and add one with the next nonce

  var deferred = Q.defer();

  db.collection('buckets').find({
    pot: {
      $lt: config.USERS_PER_POT
    },
    'users.id': {
      $not: {
        $in: [user.id]
      }
    },
    completed: false
  }).sort({
    nonce: 1
  }).limit(1).toArray(function(err, result) {
    if (err || result.length === 0) {
      // no buckets available
      createBucketWithUser(user).then(deferred.resolve);
    } else {
      addUserToBucket(result[0], user).then(deferred.resolve);
    }
  });

  return deferred.promise;
}

function randomChoice(arr) {
  return arr[Math.floor(arr.length * Math.random())];
}

function randomChangeNote() {
  return randomChoice(config.changeNotes);
}


















Worker = {

  work: function(twitter) {
    // grab the single oldest uncompleted bucket with > $25 in the pot
    // Math.Random the fuck out of that choosing process
    // send trasaction off to winner (minus our share)
    // tweet the transation and the winner
    // pay matt and ben $2.50 each transaction
    // mark those buckets as handled
    // exit

    if (!active) {
      return;
    }


    // grab most recent uncompleted bucket

    getNextBucket().then(function(bucket) {

      // @TODO(Shrugs) verify that the account has enough money to pay out
      // either via api or save it locally

      var pot = bucket.pot;
      var winner = bucket.users[Math.floor(pot * Math.random())];
      var venmo_url = 'https://venmo.com/raffle';


      // pay winner
      var note = 'Congrats ' + winner.name + '! Here\'s your $' + config.AMOUNT_TO_PAY + ' for winning @raffle #' + bucket.nonce;
      venmo.makePayment(winner.id, config.AMOUNT_TO_PAY, note, 'public');

      // pay charity
      var charityNote = 'Here\'s a donation, thanks to @raffle #' + bucket.nonce;
      venmo.makePayment(config.CHARITY, config.AMOUNT_TO_DONATE, charityNote, 'public');

      // pay ben and matt (owners)
      var perOwner = Math.floor(config.AMOUNT_TO_SEND_OWNERS/config.OWNERS.length);
      config.OWNERS.forEach(function(owner) {
        var ownerNote = 'Thanks for programming me! @raffle #' + bucket.nonce;
        venmo.makePayment(owner, perOwner, ownerNote, 'public');
      });

      console.log('PAID: ', winner.id, config.AMOUNT_TO_PAY);
      console.log('CHARITY: ', config.AMOUNT_TO_DONATE);



      twitter.statuses('update', {
              status: 'Congrats to ' + winner.name + ' for winning @rafflebot raffle #' + bucket.nonce + ' on Venmo! You\'ve been sent $' + config.AMOUNT_TO_PAY + '! ' + venmo_url
          },
          config.accessToken,
          config.accessTokenSecret,
          function(error, data, response) {
              if (error) {
                  // something went wrong
              } else {
                  // data contains the data sent by twitter
              }
          }
      );


      // set that bucket as completed
      db.collection('buckets').update({
        _id: bucket._id
      }, {
        $set: {
          completed: true
        }
      }, function(err, result) {
        if (err) {
          // alert somehow
        }
      });

    });

  },

  webhook: function(req, res) {


    var tx = req.body.data;

    // the fuck?
    if (tx === undefined) {
      console.log('wut');
      res.sendStatus(200);
      return;
    }

    // return if it's not a payment that was settles
    if (tx.action !== 'pay' || tx.status !== 'settled') {
      console.log('not a settled payment');
      res.sendStatus(200);
      return;
    }

    // return if we made this transaction ourselves
    if (tx.actor.username == config.BOT_USERNAME) {
      res.sendStatus(200);
      return;
    }

    console.log(tx);

    var actualAmount = tx.amount;
    var user = {
      name: tx.actor.username || tx.actor.display_name,
      id: tx.actor.id,
      dateJoined: new Date(tx.actor.date_joined)
    };

    var amount = Math.floor(actualAmount);
    var difference = actualAmount - amount;

    // fuck off if your account is newer than Sunday (?)
    if (user.dateJoined > config.START_DATE) {
      console.log('New user attempting to join.');
      venmo.makePayment(user.id, amount, 'Sorry, only accounts created before Monday, March 22, 2015 are allowed to participate. Here\'s your money back!', 'public');
      res.sendStatus(200);
      return;
    }

    // pay back any difference
    if (difference) {
      console.log('paying back difference: ', difference);
      venmo.makePayment(user.id, difference, randomChangeNote(), 'public');
    }

    // awesome, now put them into all of the necessary raffles

    function enterUserInRaffle(user, amt) {
      if (amt <= 0) {
        return;
      }
      addUserToNextBucket(user).then(function() {
        amt = amt - 1;
        enterUserInRaffle(user, amt);
      });
    }

    enterUserInRaffle(user, amount);

    res.sendStatus(200);
    return;

  }

};


module.exports = Worker;