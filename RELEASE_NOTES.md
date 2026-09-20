## Version v0.24.0 — September 19, 2026

### New Features

- **A team can now publish to its own GitHub organisation.** Until now every publish went to whatever owner you picked in Settings → Publishing, so a comp sitting in a shared team folder landed on the account of whoever happened to press Publish rather than the team's. A team owner can now set the team's GitHub organisation once in Manage Team → Team → Publishing, and from then on anything published out of that team's folders goes there, for everyone on the team. Your own setting still applies to everything outside a team, and a team with no organisation set behaves exactly as before.

## Version v0.23.0 — September 19, 2026

### New Features

- **Traits that cast a skill now show that skill's tooltip too.** Hovering a trait like Medic's Feedback told you the trait procs Feedback, but nothing about what Feedback actually does — you had to go find the skill yourself. The proc'd skill's full card now sits stacked above the trait's, the way the game shows it.
- **Trait bonuses that need a boon only count when you've assumed that boon.** Plenty of traits only hand out their stats while you have Quickness, Regeneration, Resolution, Alacrity, or enough Might — and the attribute panel was counting them unconditionally, so builds read higher than they play. Those bonuses now follow the assumed-boon toggles, and the attribute breakdown says which boon each one is waiting on. The boon picker marks the boons your traits actually care about and keeps them visible instead of hiding them behind the expander, so you can see at a glance what's worth assuming for this build.

### Bug Fixes

- **A shared comp could be published to your own GitHub instead of your team's.** Choosing an owner in Settings → Publishing only took effect if you then ran Setup Publishing — pick your team's organisation, close the dialog, and everything still went to your personal account. The choice is now saved the moment you make it. Separately, publishing always asked GitHub to create the builds repository as if it were a personal one, so the first publish to an organisation created the repo on your own account and then hung waiting for it to turn up under the organisation. Both the owner and the kind of owner are now used consistently.
- **Trait internal cooldowns were being shortened by Alacrity.** The new proc'd-skill card treated a trait's internal cooldown like a skill recharge and knocked 25% off it whenever Alacrity was assumed. Alacrity doesn't affect trait cooldowns, and the displayed number now matches the game.

