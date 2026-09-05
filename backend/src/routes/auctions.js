const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

// This module exports a factory so server.js can inject the shared Socket.IO instance.
// Live auction events are broadcast to room `auction:<auctionRoundId>`.
module.exports = function buildAuctionsRouter(io) {
  const router = express.Router();

  // GET /api/auctions — optionally filter by status: LIVE, SCHEDULED, CLOSED
  router.get('/', requireAuth, async (req, res) => {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE ar.status = $1`; }

    const { rows } = await db.query(
      `SELECT ar.*, cg.group_code, cp.chit_value, cp.name AS chit_name
       FROM auction_rounds ar
       JOIN chit_groups cg ON cg.id = ar.chit_group_id
       JOIN chit_plans cp ON cp.id = cg.chit_plan_id
       ${where}
       ORDER BY ar.auction_date DESC`,
      params
    );
    res.json({ auctions: rows });
  });

  // GET /api/auctions/live
  router.get('/live', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT ar.*, cg.group_code, cp.chit_value, cp.name AS chit_name
       FROM auction_rounds ar
       JOIN chit_groups cg ON cg.id = ar.chit_group_id
       JOIN chit_plans cp ON cp.id = cg.chit_plan_id
       WHERE ar.status = 'LIVE'`
    );
    res.json({ auctions: rows });
  });

  // POST /api/auctions — schedule a new auction round
  router.post('/', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { chit_group_id, round_number, auction_date } = req.body;
    if (!chit_group_id || !round_number || !auction_date) {
      return res.status(400).json({ error: 'chit_group_id, round_number and auction_date are required' });
    }
    const { rows } = await db.query(
      `INSERT INTO auction_rounds (chit_group_id, round_number, auction_date, status)
       VALUES ($1,$2,$3,'SCHEDULED') RETURNING *`,
      [chit_group_id, round_number, auction_date]
    );
    res.status(201).json({ auction: rows[0] });
  });

  // PUT /api/auctions/:id
  router.put('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { auction_date } = req.body;
    const { rows } = await db.query(
      `UPDATE auction_rounds SET auction_date = COALESCE($1, auction_date) WHERE id = $2 RETURNING *`,
      [auction_date, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    res.json({ auction: rows[0] });
  });

  // DELETE /api/auctions/:id
  router.delete('/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
    const { rows } = await db.query(`DELETE FROM auction_rounds WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    res.json({ message: 'Auction deleted' });
  });

  // POST /api/auctions/:id/start
  router.post('/:id/start', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { rows } = await db.query(
      `UPDATE auction_rounds SET status = 'LIVE', start_time = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    io.to(`auction:${req.params.id}`).emit('auction:started', rows[0]);
    res.json({ auction: rows[0] });
  });

  // POST /api/auctions/:id/pause
  router.post('/:id/pause', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { rows } = await db.query(`UPDATE auction_rounds SET status = 'PAUSED' WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    io.to(`auction:${req.params.id}`).emit('auction:paused', rows[0]);
    res.json({ auction: rows[0] });
  });

  // POST /api/auctions/:id/resume
  router.post('/:id/resume', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { rows } = await db.query(`UPDATE auction_rounds SET status = 'LIVE' WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    io.to(`auction:${req.params.id}`).emit('auction:resumed', rows[0]);
    res.json({ auction: rows[0] });
  });

  // POST /api/auctions/:id/close
  router.post('/:id/close', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { rows } = await db.query(`UPDATE auction_rounds SET status = 'CLOSED', end_time = now() WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Auction not found' });
    io.to(`auction:${req.params.id}`).emit('auction:closed', rows[0]);
    res.json({ auction: rows[0] });
  });

  // POST /api/auctions/:id/bids — place a bid (admin recording on behalf of member, or member's own auth)
  router.post('/:id/bids', requireAuth, async (req, res) => {
    const { member_id, bid_amount } = req.body;
    if (!member_id || !bid_amount) return res.status(400).json({ error: 'member_id and bid_amount are required' });

    const { rows: auctionRows } = await db.query(`SELECT * FROM auction_rounds WHERE id = $1`, [req.params.id]);
    const auction = auctionRows[0];
    if (!auction) return res.status(404).json({ error: 'Auction not found' });
    if (auction.status !== 'LIVE') return res.status(400).json({ error: 'This auction is not live' });

    // A customer can only bid for themselves
    if (req.user.role === 'CUSTOMER' && req.user.memberId !== member_id) {
      return res.status(403).json({ error: 'You can only place a bid for yourself' });
    }

    const { rows } = await db.query(
      `INSERT INTO bids (auction_round_id, member_id, bid_amount) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, member_id, bid_amount]
    );

    const bid = rows[0];
    io.to(`auction:${req.params.id}`).emit('auction:newBid', bid);
    res.status(201).json({ bid });
  });

  // GET /api/auctions/:id/bids
  router.get('/:id/bids', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT b.*, m.name AS member_name FROM bids b
       JOIN members m ON m.id = b.member_id
       WHERE b.auction_round_id = $1 AND b.status = 'ACTIVE'
       ORDER BY b.bid_amount DESC, b.bid_time ASC`,
      [req.params.id]
    );
    res.json({ bids: rows });
  });

  // GET /api/auctions/:id/result
  router.get('/:id/result', requireAuth, async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM auction_results WHERE auction_round_id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Result not available yet' });
    res.json({ result: rows[0] });
  });

  // POST /api/auctions/:id/confirm-winner — highest bidder wins, dividend split calculated
  router.post('/:id/confirm-winner', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res) => {
    const { rows: auctionRows } = await db.query(`SELECT * FROM auction_rounds WHERE id = $1`, [req.params.id]);
    const auction = auctionRows[0];
    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    const { rows: topBidRows } = await db.query(
      `SELECT * FROM bids WHERE auction_round_id = $1 AND status = 'ACTIVE' ORDER BY bid_amount DESC, bid_time ASC LIMIT 1`,
      [req.params.id]
    );
    const topBid = topBidRows[0];
    if (!topBid) return res.status(400).json({ error: 'No bids placed in this auction' });

    const { rows: chitRows } = await db.query(
      `SELECT cp.chit_value FROM auction_rounds ar
       JOIN chit_groups cg ON cg.id = ar.chit_group_id
       JOIN chit_plans cp ON cp.id = cg.chit_plan_id
       WHERE ar.id = $1`,
      [req.params.id]
    );
    const chitValue = Number(chitRows[0].chit_value);
    const winningBid = Number(topBid.bid_amount);
    const discount = chitValue - winningBid; // the "commission + dividend pool" for this round
    const netPayout = winningBid; // simplified: winner receives their bid amount
    const dividend = 0; // dividend distribution logic can be layered on top per business rules

    const { rows: resultRows } = await db.query(
      `INSERT INTO auction_results (auction_round_id, winner_id, chit_value, winning_bid, net_payout, dividend)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, topBid.member_id, chitValue, winningBid, netPayout, dividend]
    );

    await db.query(
      `UPDATE auction_rounds SET status = 'CLOSED', end_time = now(), winner_member_id = $1, winning_bid = $2 WHERE id = $3`,
      [topBid.member_id, winningBid, req.params.id]
    );
    await db.query(`UPDATE bids SET status = 'WINNING' WHERE id = $1`, [topBid.id]);

    // Auto-create a pending payout for the winner
    await db.query(
      `INSERT INTO payouts (auction_result_id, member_id, amount, status) VALUES ($1,$2,$3,'PENDING')`,
      [resultRows[0].id, topBid.member_id, netPayout]
    );

    await logAudit({ actorUserId: req.user.id, action: 'AUCTION_WINNER_CONFIRMED', entityType: 'auction_round', entityId: req.params.id, newValue: resultRows[0], ip: req.ip });

    io.to(`auction:${req.params.id}`).emit('auction:winnerConfirmed', resultRows[0]);
    res.json({ result: resultRows[0], discount });
  });

  return router;
};
