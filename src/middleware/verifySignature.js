const crypto = require('crypto');

function verifySignature(req, res, next) {
  const { courier_signature } = req.body;
  const secret = process.env.COURIER_SECRET;

  // Assuming the signature is HMAC-SHA256 of the JSON body
  const bodyString = JSON.stringify(req.body);
  const expectedSignature = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

  if (courier_signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = verifySignature;