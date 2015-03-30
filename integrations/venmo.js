var request = require('request');
var config = require('../config/config');

var BASE_URI = 'https://api.venmo.com/v1';

var Venmo = {
  makePayment: function(user_id, amount, note, audience) {
    if (audience === undefined) {
      audience = 'public';
    }
    request.post(BASE_URI + '/payments', {form: {
      access_token: config.venmoAccessToken,
      user_id: user_id,
      note: note,
      amount: amount,
      audience: audience
    }});
  }
};


module.exports = Venmo;