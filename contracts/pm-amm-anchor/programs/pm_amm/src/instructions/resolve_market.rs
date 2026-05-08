//! Resolve a market: `market.authority` or `market.resolver` may settle early (before `end_ts`)
//! or after expiry. Sets winning side, triggers final accrual to release all remaining reserves.

use anchor_lang::prelude::*;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{Market, Side};

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
}

/// Set the winning side. Before `end_ts`, only `market.authority` or `market.resolver` may resolve.
pub fn handler(ctx: Context<ResolveMarket>, winning_side: Side) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let market = &mut ctx.accounts.market;
    let signer = ctx.accounts.resolver.key();

    require!(!market.resolved, PmAmmError::MarketAlreadyResolved);

    let is_expired = now >= market.end_ts;
    let resolver_set = market.resolver != Pubkey::default();
    let is_authorized_resolver = signer == market.authority
        || (resolver_set && signer == market.resolver);

    if !is_authorized_resolver {
        msg!(
            "Resolve unauthorized. signer={} market.resolver={} market.authority={} expired={}",
            signer,
            market.resolver,
            market.authority,
            is_expired
        );
        if !is_expired {
            return err!(PmAmmError::EarlyResolveUnauthorized);
        } else {
            return err!(PmAmmError::Unauthorized);
        }
    }

    // Final accrual — releases all remaining reserves to LPs
    accrual::accrue_first(market, now)?;

    market.resolved = true;
    market.set_winning_side(winning_side);

    msg!(
        "Market {} resolved: winning_side={:?}",
        market.market_id,
        winning_side
    );

    Ok(())
}
