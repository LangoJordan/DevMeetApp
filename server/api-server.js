import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import fs from 'fs';
import nodemailer from 'nodemailer';

dotenv.config();

let admin;
let firebaseInitialized = false;
try {
  admin = await import('firebase-admin');
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
    credential = admin.credential.cert(serviceAccount);
  }
  if (credential) {
    admin.initializeApp({ credential });
    firebaseInitialized = true;
  }
} catch (error) {
  console.warn('Firebase Admin is unavailable', error);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

const mailPort = Number(process.env.MAIL_PORT || 465);
const mailTransporter = process.env.MAIL_HOST && process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD
  ? nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: mailPort,
      secure: mailPort === 465,
      auth: { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_PASSWORD },
    })
  : null;
const mailFrom = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME;

app.post('/api/reunions/finish-if-empty', async (req, res) => {
  try {
    if (!firebaseInitialized) return res.status(503).json({ error: 'Firebase Admin is not initialized' });
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = await admin.auth().verifyIdToken(token);
    const reunionId = req.body?.reunionId;
    if (typeof reunionId !== 'string' || !reunionId) return res.status(400).json({ error: 'A reunion ID is required' });

    const firestore = admin.firestore();
    const reunionRef = firestore.collection('reunions').doc(reunionId);
    const memberRef = reunionRef.collection('roomMembers').doc(decoded.uid);
    const outcome = await firestore.runTransaction(async (transaction) => {
      const member = await transaction.get(memberRef);
      if (!member.exists || member.data()?.kicked === true) return { authorized: false, finished: false };
      const reunion = await transaction.get(reunionRef);
      if (!reunion.exists || ['completed', 'closed'].includes(reunion.data()?.status)) return { authorized: true, finished: false };
      const participants = await transaction.get(reunionRef.collection('participants').limit(1));
      if (!participants.empty) return { authorized: true, finished: false };
      transaction.update(reunionRef, { status: 'completed', endedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { authorized: true, finished: true };
    });
    if (!outcome.authorized) return res.status(403).json({ error: 'Active room membership required' });
    return res.json({ finished: outcome.finished });
  } catch (error) {
    console.error('Unable to finish empty reunion', error);
    return res.status(500).json({ error: 'Unable to finish empty reunion' });
  }
});

app.post('/api/deactivate-account', async (req, res) => {
  try {
    if (!firebaseInitialized) return res.status(500).json({ error: 'Firebase is not initialized' });
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== req.body?.uid) return res.status(403).json({ error: 'Not authorized' });
    await admin.auth().updateUser(decoded.uid, { disabled: true });
    return res.json({ success: true });
  } catch (error) {
    console.error('Unable to deactivate account', error);
    return res.status(500).json({ error: 'Unable to deactivate account' });
  }
});

app.post('/api/send-invitations-email', async (req, res) => {
  try {
    if (!mailTransporter) return res.status(500).json({ error: 'Email is not configured' });
    const { invitations } = req.body || {};
    if (!Array.isArray(invitations) || invitations.length === 0) {
      return res.status(400).json({ error: 'Invitations are required' });
    }
    await Promise.all(invitations.map((invitation) => {
      if (!invitation.toEmail) return Promise.resolve();
      const date = invitation.begin ? new Date(invitation.begin).toLocaleString('fr-FR') : 'bientôt';
      const roomUrl = invitation.roomUrl || invitation.joinUrl || '';
      const text = [
        `Bonjour ${invitation.toName || ''}`.trim(),
        '',
        `Vous êtes invité(e) à la réunion "${invitation.meetingTitle || 'Réunion'}".`,
        invitation.meetingDescription ? `Description : ${invitation.meetingDescription}` : '',
        `Date/heure : ${date}`,
        roomUrl ? `Lien pour rejoindre la réunion : ${roomUrl}` : 'Le lien de réunion vous sera communiqué ultérieurement.',
        '',
        'Cet email a été envoyé automatiquement par Meet-Flow.',
      ].join('\n');
      return mailTransporter.sendMail({
        from: mailFrom,
        to: invitation.toEmail,
        subject: `Invitation à la réunion : ${invitation.meetingTitle || 'Réunion Meet-Flow'}`,
        text,
      }).catch((error) => console.warn('Unable to send invitation email', error));
    }));
    return res.json({ success: true });
  } catch (error) {
    console.error('Unable to send invitation emails', error);
    return res.status(500).json({ error: 'Unable to send invitation emails' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Meet-Flow API listening on port ${port}`));
