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

module.exports = { getDiscordEmoji, getDisplayName, DISCORD_EMOJI };
