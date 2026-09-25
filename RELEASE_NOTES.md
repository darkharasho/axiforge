## Version v1.0.1 — September 25, 2026

### Bug Fixes

- **The build title bar went lopsided once the tags wrapped.** A build with enough tags to fill a second line stretched the title field and the profession picker to match it, leaving two tall empty boxes beside the tags. Each field now keeps its own height, and tags gets the width the other two were not using.
- **The health figure is red again.** The new look had drawn it in the same ink as everything around it. It is filled red, the colour the game gives it, so the number is findable before it is read.
- **Trait icons and the specialization emblem lost the box drawn around them.** The artwork is already a finished shape; a square control border around it framed nothing. A chosen trait is marked by an accent rule beneath it instead.
- **The class and elite-spec stamp is back in the middle of the equipment view.** It is drawn at full strength in the icon's own colours, and on a published page that carries a theme it takes that theme's accent.

## Version v1.0.0 — September 24, 2026

AxiForge leaves beta. The version number in the title bar is the badge that used to say so.

### New Features

- **A new look.** The app's chrome, library, compositions, build editor, published build pages and web playground have been redrawn in the axi-design language: flat surfaces outlined in ink, hard offset blocks instead of blurred shadows, square corners, and one typographic scale. Colours in those surfaces are named tokens rather than literals, so your accent choice reaches parts of the interface it never used to. The dialogs keep their previous look for now.
- **The editor reads more plainly.** A few pieces changed shape as well as colour. The health orb is now a square reading tile with the HP figure at its centre, instead of a glowing globe with a fill behind the number. Attunement and upgrade-kind buttons lost their hues -- each already prints its element or its kind, and the one that is chosen is now filled instead. Equipment slot rows are drawn as the panel's interior, separated by hairlines, and stand up as a control only under the cursor or the keyboard. The damage breakdown's category chips are one outlined shape rather than eleven colours, and the profession watermark behind the equipment columns is gone.
- **A wider, resizable library sidebar, and comps in two columns.** The folder sidebar can be dragged to the width your folder names actually need — double-click the handle, or press Home on it, to snap back. The comps list fills the pane as a two-column grid instead of one narrow column.
- **Settings moved onto the left rail.** It sits with the rest of the app's destinations instead of in the title bar, which now carries only the version and the update status.

### Bug Fixes

- **Icons inside buttons were drawing at zero size.** Every icon sitting inside a button collapsed to nothing, so several buttons showed their label with an empty gap beside it.
- **Collapsing the library sidebar emptied the content pane.** The build list disappeared until you expanded the sidebar again.
- **A filter menu's first open landed against the left edge of the window** instead of under the control that opened it, and the filter triggers drew two dropdown arrows.
- **The library table header only looked locked to the top** — it scrolled away with the rows underneath it.
- **The signed-in username drew in the browser's default font** rather than the app's.
- **A composition's self-boon toggle opened inverted**, showing the opposite of the state it was in.

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

