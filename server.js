const express  = require('express');
const axios    = require('axios');
const cors     = require('cors');
require('dotenv').config();

const app  = express();
app.use(express.json());
app.use(cors());

const {
  CONSUMER_KEY, CONSUMER_SECRET,
  BUSINESS_SHORT_CODE, PASSKEY,
  CALLBACK_URL,
  B2C_INITIATOR_NAME, B2C_SECURITY_CRED,
  B2C_PARTY_A, B2C_RESULT_URL, B2C_TIMEOUT_URL,
  PORT = 3000, SANDBOX = 'true',
} = process.env;

const BASE_URL = SANDBOX === 'true'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

const stkStore = {};

async function getToken() {
  const creds = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` } });
  return res.data.access_token;
}

function getPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
  const password  = Buffer.from(`${BUSINESS_SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64');
  return { password, timestamp };
}

app.get('/', (req,res) => res.json({ status:'ok', mode: SANDBOX==='true'?'SANDBOX':'PRODUCTION' }));

app.post('/stk-push', async (req,res) => {
  try {
    const { phone, amount, accountRef='JACKPOT', userId } = req.body;
    const token = await getToken();
    const { password, timestamp } = getPassword();
    const payload = {
      BusinessShortCode: BUSINESS_SHORT_CODE,
      Password: password, Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount), PartyA: phone,
      PartyB: BUSINESS_SHORT_CODE, PhoneNumber: phone,
      CallBackURL: CALLBACK_URL, AccountReference: accountRef,
      TransactionDesc: `Deposit by ${userId}`
    };
    const response = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload,
      { headers: { Authorization: `Bearer ${token}` } });
    const { ResponseCode, CheckoutRequestID, CustomerMessage } = response.data;
    if (ResponseCode === '0') stkStore[CheckoutRequestID] = { status:'PENDING', amount, userId };
    res.json({ ResponseCode, CheckoutRequestID, CustomerMessage });
  } catch(err) {
    res.status(500).json({ error:'STK Push failed', detail: err.response?.data });
  }
});

app.post('/stk-callback', (req,res) => {
  const body = req.body?.Body?.stkCallback;
  if (body) {
    const { CheckoutRequestID, ResultCode } = body;
    if (stkStore[CheckoutRequestID])
      stkStore[CheckoutRequestID].status = ResultCode===0 ? 'SUCCESS':'FAILED';
  }
  res.json({ ResultCode:0, ResultDesc:'OK' });
});

app.get('/stk-status', (req,res) => {
  const record = stkStore[req.query.id];
  res.json({ status: record ? record.status : 'PENDING' });
});

app.post('/b2c', async (req,res) => {
  try {
    const { phone, amount, userId, remarks='Withdrawal' } = req.body;
    const token = await getToken();
    const payload = {
      InitiatorName: B2C_INITIATOR_NAME,
      SecurityCredential: B2C_SECURITY_CRED,
      CommandID: 'BusinessPayment',
      Amount: Math.ceil(amount), PartyA: B2C_PARTY_A, PartyB: phone,
      Remarks: remarks, QueueTimeOutURL: B2C_TIMEOUT_URL,
      ResultURL: B2C_RESULT_URL, Occasion: `Withdrawal by ${userId}`
    };
    const response = await axios.post(`${BASE_URL}/mpesa/b2c/v3/paymentrequest`, payload,
      { headers: { Authorization: `Bearer ${token}` } });
    const { ResponseCode, ResponseDescription } = response.data;
    res.json({ ResponseCode, ResponseDescription });
  } catch(err) {
    res.status(500).json({ error:'B2C failed', detail: err.response?.data });
  }
});

app.post('/b2c-result', (req,res) => res.json({ ResultCode:0, ResultDesc:'OK' }));
app.post('/b2c-timeout', (req,res) => res.json({ ResultCode:0, ResultDesc:'OK' }));

app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
