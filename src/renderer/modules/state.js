// Application state — single source of truth for the renderer.
// All modules read/mutate this shared object by reference.

export const state = {
  user: null,
  onboarding: null,
  targets: [],
  selectedTarget: null,
  pagesPoll: {
    active: false,
    status: "",
    error: null,
  },
  loginFlow: {
    pending: false,
    beginData: null,
    waitingForApproval: false,
  },
  builds: [],
  professions: [],
  activePage: "library",
  buildSearch: "",
  // Library state
  folders: [],
  currentFolder: null,      // { type: "smart"|"custom", id: string } or null (root)
  libraryPrefs: {
    viewMode: "list",
    sortField: "sortOrder",
    sortDirection: "asc",
    sidebarOpen: true,
    sidebarExpandedFolders: [],
    activeFilters: {},
  },
  // Comp state
  comps: [],
  activeComp: null,
  compPage: "list",   // "list" | "detail"
  compSearch: "",
  compPoolSearch: "",  // search within build pool in detail view
  compPrefs: {
    sortField: "updatedAt",
    sortDirection: "desc",
    activeFilters: {},
    boonCoverageCollapsed: false,
  },
  skillSearch: "",
  catalogCache: new Map(),
  activeCatalog: null,
  upgradeCatalog: null,  // { runes, sigils, infusions, enrichments, runeById, sigilById, infusionById, enrichmentById }
  renderedSkillIconIds: new Map(),
  editor: null,  // populated by init() after createEmptyEditor() is available
  editorBaselineSignature: "",
  editorDirty: false,
  detail: null,
  wikiCache: new Map(),
  openCustomSelect: null,
};

export function createEmptyEditor(profession = "", gameMode = "pve") {
  return {
    id: "",
    title: "",
    profession,
    tags: [],
    notes: "",
    images: {},
    equipment: {
      statPackage: "",
      relic: "",
      food: "",
      utility: "",
      slots: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "",
        back: "", amulet: "", ring1: "", ring2: "", accessory1: "", accessory2: "",
        breather: "", aquatic1: "", aquatic2: "",
      },
      weapons: {
        mainhand1: "", offhand1: "", mainhand2: "", offhand2: "", aquatic1: "", aquatic2: "",
      },
      runes: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        breather: "",
      },
      sigils: {
        mainhand1: ["", ""], offhand1: [""],
        mainhand2: ["", ""], offhand2: [""],
        aquatic1: ["", ""], aquatic2: ["", ""],
      },
      infusions: {
        head: "", shoulders: "", chest: "", hands: "", legs: "", feet: "",
        mainhand1: ["", ""], offhand1: [""], mainhand2: ["", ""], offhand2: [""],
        back: ["", ""],
        ring1: ["", "", ""], ring2: ["", "", ""],
        accessory1: "", accessory2: "",
        breather: [""], aquatic1: ["", ""], aquatic2: ["", ""],
      },
      enrichment: "",
    },
    specializations: [],
    skills: {
      healId: 0,
      utilityIds: [0, 0, 0],
      eliteId: 0,
    },
    underwaterSkills: {
      healId: 0,
      utilityIds: [0, 0, 0],
      eliteId: 0,
    },
    underwaterMode: false,
    activeAttunement: "",
    activeAttunement2: "",
    activeKit: 0,
    activeWeaponSet: 1,
    morphSkillIds: [0, 0, 0],
    // Revenant: two legend slots (active/inactive), identified by legend string ID (e.g. "Legend1")
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    activeLegendSlot: 0,           // 0 = first legend active, 1 = second legend active
    // Ranger/Soulbeast: two pet slots (terrestrial + aquatic) per legend slot (A/B)
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    activePetSlot: "terrestrial1",  // "terrestrial1" or "terrestrial2"
    allianceTacticsForm: 0,         // Vindicator: 0 = Archemorus/Kurzick, 1 = Saint Viktor/Luxon
    antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 }, // Antiquary: stored artifact draws (0 = not yet drawn)
    gameMode: gameMode || "pve",
  };
}

// Initialize state.editor after module load (avoids circular dependency at declaration time).
state.editor = createEmptyEditor();
