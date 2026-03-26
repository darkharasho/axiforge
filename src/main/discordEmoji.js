"use strict";

const DISCORD_EMOJI = {
  // Core professions
  Elementalist: "<:Elementalist:1469132399848853637>",
  Engineer:     "<:Engineer:1484322965368602746>",
  Guardian:     "<:Guardian:1469132552752206010>",
  Mesmer:       "<:Mesmer:1469132581806145662>",
  Necromancer:  "<:Necromancer:1469132584243171368>",
  Ranger:       "<:Ranger:1469132669550985389>",
  Revenant:     "<:Revenant:1469132675695771689>",
  Thief:        "<:Thief:1469132794071355525>",
  Warrior:      "<:Warrior:1469132852938407987>",
  // Elite specs
  Amalgam:      "<:Amalgam:1469132309138767973>",
  Antiquary:    "<:Antiquary:1469132340365099061>",
  Berserker:    "<:Berserker:1469132341371994174>",
  Bladesworn:   "<:Bladesworn:1469132343326277763>",
  Catalyst:     "<:Catalyst:1469132344886689917>",
  Chronomancer: "<:Chronomancer:1469132346296107018>",
  Conduit:      "<:Conduit:1469132392798224465>",
  Daredevil:    "<:Daredevil:1469132393951793331>",
  Deadeye:      "<:Deadeye:1469132396208066624>",
  Dragonhunter: "<:Dragonhunter:1469132397252575292>",
  Druid:        "<:Druid:1469132398514933975>",
  Evoker:       "<:Evoker:1484323009438154924>",
  Firebrand:    "<:Firebrand:1472731858981879880>",
  Galeshot:     "<:Galeshot:1469132551376470016>",
  Harbinger:    "<:Harbinger:1469132554069348465>",
  Herald:       "<:Herald:1469132555428298926>",
  Holosmith:    "<:Holosmith:1469132557030260971>",
  Luminary:     "<:Luminary:1469132578731851878>",
  Mechanist:    "<:Mechanist:1469132580195401890>",
  Mirage:       "<:Mirage:1469132583060111462>",
  Paragon:      "<:Paragon:1469132585429893172>",
  Reaper:       "<:Reaper:1469132671056875570>",
  Renegade:     "<:Renegade:1469132673917128826>",
  Ritualist:    "<:Ritualist:1469132678375931914>",
  Scourge:      "<:Scourge:1469132763444547717>",
  Scrapper:     "<:Scrapper:1469132764883452070>",
  Soulbeast:    "<:Soulbeast:1469132766619893854>",
  Specter:      "<:Specter:1469132768448352369>",
  Spellbreaker: "<:Spellbreaker:1469132769459175445>",
  Tempest:      "<:Tempest:1469132792616190139>",
  Troubadour:   "<:Troubadour:1469132796151726182>",
  Untamed:      "<:Untamed:1469132799696175288>",
  Vindicator:   "<:Vindicator:1469132800958660816>",
  Virtuoso:     "<:Virtuoso:1469132851520737280>",
  Weaver:       "<:Weaver:1469132854524121243>",
  Willbender:   "<:Willbender:1469132856520605707>",
};

// Spec-line emoji — keyed by "Profession_SpecName" (spaces → underscores).
// Elite specs prefixed with "elite_".  Spread across two emoji servers.
const SPEC_LINE_EMOJI = {
  // ── Elementalist ──
  Elementalist_Air:     "<:Elementalist_Air:1486776411866923048>",
  Elementalist_Arcane:  "<:Elementalist_Arcane:1486783780575510659>",
  Elementalist_Earth:   "<:Elementalist_Earth:1486783955163414559>",
  Elementalist_Fire:    "<:Elementalist_Fire:1486783952982380625>",
  Elementalist_Water:   "<:Elementalist_Water:1486783972980822107>",
  elite_Elementalist_Catalyst: "<:elite_Elementalist_Catalyst:1486761376201576560>",
  elite_Elementalist_Evoker:   "<:elite_Elementalist_Evoker:1486761304613195958>",
  elite_Elementalist_Tempest:  "<:elite_Elementalist_Tempest:1486761468203372625>",
  elite_Elementalist_Weaver:   "<:elite_Elementalist_Weaver:1486761457973592145>",
  // ── Engineer ──
  Engineer_Alchemy:    "<:Engineer_Alchemy:1486783948964233216>",
  Engineer_Explosives: "<:Engineer_Explosives:1486783990667935815>",
  Engineer_Firearms:   "<:Engineer_Firearms:1486783777907806248>",
  Engineer_Inventions: "<:Engineer_Inventions:1486761527733256253>",
  Engineer_Tools:      "<:Engineer_Tools:1486783962507378838>",
  elite_Engineer_Amalgam:   "<:elite_Engineer_Amalgam:1486761367720431666>",
  elite_Engineer_Holosmith: "<:elite_Engineer_Holosmith:1486761416894714007>",
  elite_Engineer_Mechanist: "<:elite_Engineer_Mechanist:1486761374481776712>",
  elite_Engineer_Scrapper:  "<:elite_Engineer_Scrapper:1486776403839029269>",
  // ── Guardian ──
  Guardian_Honor:   "<:Guardian_Honor:1486761465045057596>",
  Guardian_Radiance:"<:Guardian_Radiance:1486783969604407410>",
  Guardian_Valor:   "<:Guardian_Valor:1486783983613378630>",
  Guardian_Virtues: "<:Guardian_Virtues:1486761463610736893>",
  Guardian_Zeal:    "<:Guardian_Zeal:1486761627226476616>",
  elite_Guardian_Dragonhunter: "<:elite_Guardian_Dragonhunter:1486783950843150387>",
  elite_Guardian_Firebrand:    "<:elite_Guardian_Firebrand:1486761410221576265>",
  elite_Guardian_Luminary:     "<:elite_Guardian_Luminary:1486761303644180480>",
  elite_Guardian_Willbender:   "<:elite_Guardian_Willbender:1486761408917016606>",
  // ── Mesmer ──
  Mesmer_Chaos:       "<:Mesmer_Chaos:1486761462067367946>",
  Mesmer_Domination:  "<:Mesmer_Domination:1486784262769213450>",
  Mesmer_Dueling:     "<:Mesmer_Dueling:1486783997634936832>",
  Mesmer_Illusions:   "<:Mesmer_Illusions:1486784254309302333>",
  Mesmer_Inspiration: "<:Mesmer_Inspiration:1486783958778908844>",
  elite_Mesmer_Chronomancer: "<:elite_Mesmer_Chronomancer:1486761628669186160>",
  elite_Mesmer_Mirage:       "<:elite_Mesmer_Mirage:1486761415330234368>",
  elite_Mesmer_Troubadour:   "<:elite_Mesmer_Troubadour:1486761311961481346>",
  elite_Mesmer_Virtuoso:     "<:elite_Mesmer_Virtuoso:1486761407289491616>",
  // ── Necromancer ──
  Necromancer_Blood_Magic:  "<:Necromancer_Blood_Magic:1486784256872288427>",
  Necromancer_Curses:       "<:Necromancer_Curses:1486761626005803018>",
  Necromancer_Death_Magic:  "<:Necromancer_Death_Magic:1486784269899796562>",
  Necromancer_Soul_Reaping: "<:Necromancer_Soul_Reaping:1486761459416301629>",
  Necromancer_Spite:        "<:Necromancer_Spite:1486761453762515106>",
  elite_Necromancer_Harbinger:  "<:elite_Necromancer_Harbinger:1486761379531591781>",
  elite_Necromancer_Reaper:     "<:elite_Necromancer_Reaper:1486783779191259298>",
  elite_Necromancer_Ritualist:  "<:elite_Necromancer_Ritualist:1486761309717397537>",
  elite_Necromancer_Scourge:    "<:elite_Necromancer_Scourge:1486761414298439812>",
  // ── Ranger ──
  Ranger_Beastmastery:        "<:Ranger_Beastmastery:1486783947420471326>",
  Ranger_Marksmanship:        "<:Ranger_Marksmanship:1486784266728636568>",
  Ranger_Nature_Magic:        "<:Ranger_Nature_Magic:1486783957545648309>",
  Ranger_Skirmishing:         "<:Ranger_Skirmishing:1486783946351181934>",
  Ranger_Wilderness_Survival: "<:Ranger_Wilderness_Survival:1486783755158028438>",
  elite_Ranger_Druid:     "<:elite_Ranger_Druid:1486783994149208235>",
  elite_Ranger_Galeshot:  "<:elite_Ranger_Galeshot:1486761308597649569>",
  elite_Ranger_Soulbeast: "<:elite_Ranger_Soulbeast:1486761456497070180>",
  elite_Ranger_Untamed:   "<:elite_Ranger_Untamed:1486761373340799006>",
  // ── Revenant ──
  Revenant_Corruption:  "<:Revenant_Corruption:1486783980211798176>",
  Revenant_Devastation: "<:Revenant_Devastation:1486783966282252409>",
  Revenant_Invocation:  "<:Revenant_Invocation:1486783987509891112>",
  Revenant_Retribution: "<:Revenant_Retribution:1486784261661917315>",
  Revenant_Salvation:   "<:Revenant_Salvation:1486783976596045918>",
  elite_Revenant_Conduit:   "<:elite_Revenant_Conduit:1486761302649995324>",
  elite_Revenant_Herald:    "<:elite_Revenant_Herald:1486761454857359360>",
  elite_Revenant_Renegade:  "<:elite_Revenant_Renegade:1486761378353254641>",
  elite_Revenant_Vindicator:"<:elite_Revenant_Vindicator:1486761371378122774>",
  // ── Thief ──
  Thief_Acrobatics:      "<:Thief_Acrobatics:1486761452407885854>",
  Thief_Critical_Strikes:"<:Thief_Critical_Strikes:1486783753312534588>",
  Thief_Deadly_Arts:     "<:Thief_Deadly_Arts:1486783944765608107>",
  Thief_Shadow_Arts:     "<:Thief_Shadow_Arts:1486784255529975889>",
  Thief_Trickery:        "<:Thief_Trickery:1486761624294391900>",
  elite_Thief_Antiquary: "<:elite_Thief_Antiquary:1486761307456933998>",
  elite_Thief_Daredevil: "<:elite_Thief_Daredevil:1486784289260568628>",
  elite_Thief_Deadeye:   "<:elite_Thief_Deadeye:1486761413048533133>",
  elite_Thief_Specter:   "<:elite_Thief_Specter:1486761370010652682>",
  // ── Warrior ──
  Warrior_Arms:       "<:Warrior_Arms:1486776409283104961>",
  Warrior_Defense:    "<:Warrior_Defense:1486783956434157750>",
  Warrior_Discipline: "<:Warrior_Discipline:1486761418085630124>",
  Warrior_Strength:   "<:Warrior_Strength:1486784264803582126>",
  Warrior_Tactics:    "<:Warrior_Tactics:1486784260370071562>",
  elite_Warrior_Berserker:    "<:elite_Warrior_Berserker:1486784258591821885>",
  elite_Warrior_Bladesworn:   "<:elite_Warrior_Bladesworn:1486761368505024673>",
  elite_Warrior_Paragon:      "<:elite_Warrior_Paragon:1486761305963761934>",
  elite_Warrior_Spellbreaker: "<:elite_Warrior_Spellbreaker:1486761411303440404>",
};

function getSpecLineEmoji(profession, specName, elite) {
  const key = elite
    ? `elite_${profession}_${specName.replace(/ /g, "_")}`
    : `${profession}_${specName.replace(/ /g, "_")}`;
  return SPEC_LINE_EMOJI[key] || "";
}

function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

function getDiscordEmoji(build) {
  const elite = getEliteSpecName(build);
  if (elite && DISCORD_EMOJI[elite]) return DISCORD_EMOJI[elite];
  if (build.profession && DISCORD_EMOJI[build.profession]) return DISCORD_EMOJI[build.profession];
  return "";
}

function getDisplayName(build) {
  return build.title || getEliteSpecName(build) || build.profession || "Untitled";
}

module.exports = { getDiscordEmoji, getDisplayName, getEliteSpecName, getSpecLineEmoji, DISCORD_EMOJI };
