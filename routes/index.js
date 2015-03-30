var express = require('express');
var router = express.Router();
var worker = require('../jobs/worker');

var venmo = require('../integrations/venmo');

router.get('/', function(req, res) {
  res.sendfile('../views/index.html');
});

router.get('/raffie', function(req, res) {
  res.send(req.query.venmo_challenge || 'k');
});

router.post('/raffie', worker.webhook);

module.exports = router;
