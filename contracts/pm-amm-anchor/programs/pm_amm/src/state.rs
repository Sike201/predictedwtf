//! On-chain state for pm-AMM: Market and LpPosition accounts.
//!
//! All fixed-point fields use Q64.64 encoding (stored as `u128`, converted via
//! `I80F48` helpers). See the Paradigm pm-AMM paper for formula references.

use anchor_lang::prelude::*;
use fixed::types::I80F48;

// ============================================================================
// Side enum
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

// ============================================================================
// Market — PDA seeds: [b"market", market_id.to_le_bytes()]
// ============================================================================

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub market_id: u64,
    pub collateral_mint: Pubkey, // USDC
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey, // single USDC vault

    pub start_ts: i64,
    pub end_ts: i64, // T (expiration)

    // AMM params — Q64.64 stored as u128
    pub l_zero: u128,      // L_0 constant
    pub reserve_yes: u128, // x (YES reserve)
    pub reserve_no: u128,  // y (NO reserve)

    // Accrual dC_t — per-share accumulators (Q64.64)
    pub last_accrual_ts: i64,
    pub cum_yes_per_share: u128, // cumulative YES released per LP share
    pub cum_no_per_share: u128,  // cumulative NO released per LP share

    // Stats
    pub total_yes_distributed: u64, // total YES tokens distributed to LPs
    pub total_no_distributed: u64,  // total NO tokens distributed to LPs

    // LP accounting
    pub total_lp_shares: u128,

    // Resolution
    pub resolved: bool,
    pub winning_side: u8, // 0 = unresolved, 1 = Yes, 2 = No

    pub bump: u8,

    /// Schema version for off-chain / tooling. `2` = `resolver` before `name` (this field order).
    pub layout_version: u8,

    /// Dedicated early resolver (e.g. trusted oracle wallet). `Pubkey::default()` means
    /// “unset” for legacy accounts; treat as authority-only for off-chain matching.
    ///
    /// **Must come before `name`:** Anchor account serialization omits trailing fields after
    /// certain layouts; `resolver` after `name` was not persisted (account tail stayed zero).
    pub resolver: Pubkey,

    // Market name (UTF-8, zero-padded)
    pub name: [u8; 64],

    /// Trailing reserved bytes (legacy sizing — zeroed on init).
    pub reserved: [u8; 32],
}

impl Market {
    pub const SEED: &'static [u8] = b"market";

    /// Space: 8 discriminator + fields + padding.
    pub const LEN: usize = 8 // discriminator
        + 32 // authority
        + 8  // market_id
        + 32 // collateral_mint
        + 32 // yes_mint
        + 32 // no_mint
        + 32 // vault
        + 8  // start_ts
        + 8  // end_ts
        + 16 // l_zero
        + 16 // reserve_yes
        + 16 // reserve_no
        + 8  // last_accrual_ts
        + 16 // cum_yes_per_share
        + 16 // cum_no_per_share
        + 8  // total_yes_distributed
        + 8  // total_no_distributed
        + 16 // total_lp_shares
        + 1  // resolved
        + 1  // winning_side
        + 1  // bump
        + 1  // layout_version
        + 32 // resolver (before `name` so Anchor serializes it)
        + 64 // name
        + 32; // reserved tail

    // --- Q64.64 helpers ---

    pub fn l_zero_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.l_zero as i128)
    }
    pub fn set_l_zero_fixed(&mut self, v: I80F48) {
        self.l_zero = v.to_bits() as u128;
    }

    pub fn reserve_yes_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.reserve_yes as i128)
    }
    pub fn set_reserve_yes_fixed(&mut self, v: I80F48) {
        self.reserve_yes = v.to_bits() as u128;
    }

    pub fn reserve_no_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.reserve_no as i128)
    }
    pub fn set_reserve_no_fixed(&mut self, v: I80F48) {
        self.reserve_no = v.to_bits() as u128;
    }

    pub fn cum_yes_per_share_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.cum_yes_per_share as i128)
    }
    pub fn set_cum_yes_per_share_fixed(&mut self, v: I80F48) {
        self.cum_yes_per_share = v.to_bits() as u128;
    }

    pub fn cum_no_per_share_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.cum_no_per_share as i128)
    }
    pub fn set_cum_no_per_share_fixed(&mut self, v: I80F48) {
        self.cum_no_per_share = v.to_bits() as u128;
    }

    pub fn total_lp_shares_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.total_lp_shares as i128)
    }
    pub fn set_total_lp_shares_fixed(&mut self, v: I80F48) {
        self.total_lp_shares = v.to_bits() as u128;
    }

    /// Return the market name as a UTF-8 string (trailing zeros trimmed).
    pub fn name_str(&self) -> &str {
        let len = self
            .name
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(self.name.len());
        core::str::from_utf8(&self.name[..len]).unwrap_or("")
    }

    /// L_eff = L_0 * sqrt(T - t). Paper section 8.
    pub fn l_effective(&self, now: i64) -> Result<I80F48> {
        crate::pm_math::l_effective(self.l_zero_fixed(), self.end_ts - now)
    }

    /// Return the resolved winning side, or None if not yet resolved.
    pub fn get_winning_side(&self) -> Option<Side> {
        match self.winning_side {
            1 => Some(Side::Yes),
            2 => Some(Side::No),
            _ => None,
        }
    }

    /// Set the winning side (1 = YES, 2 = NO).
    pub fn set_winning_side(&mut self, side: Side) {
        self.winning_side = match side {
            Side::Yes => 1,
            Side::No => 2,
        };
    }
}

// ============================================================================
// LpPosition — PDA seeds: [b"lp", market.key(), owner.key()]
// ============================================================================

#[account]
pub struct LpPosition {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: u128,
    pub collateral_deposited: u64,
    pub yes_per_share_checkpoint: u128,
    pub no_per_share_checkpoint: u128,
    pub bump: u8,
}

impl LpPosition {
    pub const SEED: &'static [u8] = b"lp";
    pub const LEN: usize = 8 + 32 + 32 + 16 + 8 + 16 + 16 + 1 + 16;
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_q64_roundtrip() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            layout_version: 2,
            resolver: Pubkey::default(),
            name: [0u8; 64],
            reserved: [0u8; 32],
        };

        // Test various values round-trip through u128 storage
        for val in [0.0, 1.0, 398.942, 1000.0, 0.001, 123456.789] {
            let fixed_val = I80F48::from_num(val);
            market.set_l_zero_fixed(fixed_val);
            let got = market.l_zero_fixed();
            assert_eq!(got, fixed_val, "Q64.64 roundtrip failed for {val}");
        }

        // Test reserves
        let x = I80F48::from_num(1328.895);
        let y = I80F48::from_num(47.343);
        market.set_reserve_yes_fixed(x);
        market.set_reserve_no_fixed(y);
        assert_eq!(market.reserve_yes_fixed(), x);
        assert_eq!(market.reserve_no_fixed(), y);

        // Test cum_per_share
        let c = I80F48::from_num(0.000001);
        market.set_cum_yes_per_share_fixed(c);
        assert_eq!(market.cum_yes_per_share_fixed(), c);
    }

    #[test]
    fn market_rust_size_vs_serialized_len() {
        use anchor_lang::AnchorSerialize;
        use std::mem::size_of;
        let m = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            layout_version: 2,
            resolver: Pubkey::default(),
            name: [0u8; 64],
            reserved: [0u8; 32],
        };
        let mut buf = Vec::new();
        m.serialize(&mut buf).unwrap();
        eprintln!("size_of Market = {}", size_of::<Market>());
        eprintln!("anchor_serialized len = {}", buf.len());
        eprintln!("Market::LEN - 8 = {}", Market::LEN - 8);
    }

    #[test]
    fn market_anchor_serialize_includes_resolver_before_name() {
        use anchor_lang::AnchorSerialize;
        let resolver = Pubkey::new_from_array([9u8; 32]);
        let m = Market {
            authority: Pubkey::new_from_array([1u8; 32]),
            market_id: 42,
            collateral_mint: Pubkey::new_from_array([2u8; 32]),
            yes_mint: Pubkey::new_from_array([3u8; 32]),
            no_mint: Pubkey::new_from_array([4u8; 32]),
            vault: Pubkey::new_from_array([5u8; 32]),
            start_ts: 1,
            end_ts: 2,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            layout_version: 2,
            resolver,
            name: [0u8; 64],
            reserved: [0u8; 32],
        };
        let mut buf = Vec::new();
        m.serialize(&mut buf).unwrap();
        assert_eq!(
            buf.len(),
            Market::LEN - 8,
            "serialized market body should match LEN minus 8-byte account discriminator"
        );
        // Byte offset of `resolver` in serialized account body (after 8-byte disc), borsh order.
        const RESOLVER_BODY_OFFSET: usize = 308;
        let got: [u8; 32] = buf[RESOLVER_BODY_OFFSET..RESOLVER_BODY_OFFSET + 32]
            .try_into()
            .unwrap();
        assert_eq!(Pubkey::new_from_array(got), resolver);
    }

    #[test]
    fn test_winning_side() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            layout_version: 2,
            resolver: Pubkey::default(),
            name: [0u8; 64],
            reserved: [0u8; 32],
        };

        assert_eq!(market.get_winning_side(), None);
        market.set_winning_side(Side::Yes);
        assert_eq!(market.get_winning_side(), Some(Side::Yes));
        market.set_winning_side(Side::No);
        assert_eq!(market.get_winning_side(), Some(Side::No));
    }
}
