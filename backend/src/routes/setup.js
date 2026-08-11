const express = require('express');
const Business = require('../models/Business');
const CatalogItem = require('../models/CatalogItem');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// Reports which onboarding steps are complete so the frontend wizard can guide the owner.
router.get('/status', async (req, res) => {
  const business = await Business.findOne({ user: req.userId });
  if (!business) return res.status(404).json({ error: 'No business found for this account' });

  const catalogCount = await CatalogItem.countDocuments({ business: business._id });
  const connected = business.whatsappStatus === 'connected';
  const profileDone = !!(business.ownerNumber && String(business.ownerNumber).trim());

  const steps = [
    { key: 'account', title: 'Create your account', desc: 'Your login is ready — welcome!', done: true, href: null },
    {
      key: 'profile',
      title: 'Set up your business',
      desc: 'Add your business details and the owner WhatsApp number where order alerts should arrive.',
      done: profileDone,
      href: '/settings',
    },
    {
      key: 'connect',
      title: 'Connect WhatsApp',
      desc: 'Link your business number so the AI can chat with customers. (Scan a QR code, about 30 seconds.)',
      done: connected,
      href: '/connect',
    },
    {
      key: 'products',
      title: 'Add products',
      desc: 'Add what you sell — the AI sends these as clickable links to customers.',
      done: catalogCount > 0,
      href: '/catalog',
    },
    {
      key: 'activate',
      title: 'Activate the bot',
      desc: 'Open your store so the bot starts replying to messages automatically.',
      done: !!business.botActive,
      href: '/dashboard',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  res.json({
    steps,
    doneCount,
    total: steps.length,
    inProgress: ['connecting', 'qr', 'pairing'].includes(business.whatsappStatus) ? business.whatsappStatus : null,
    business: {
      name: business.name,
      whatsappStatus: business.whatsappStatus,
      whatsappNumber: business.whatsappNumber,
      ownerNumber: business.ownerNumber,
      botActive: business.botActive,
      catalogCount,
    },
  });
});

module.exports = router;
