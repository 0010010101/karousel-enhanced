const defaultWindowRules = `[
    {
        "class": "(org\\\\.kde\\\\.)?plasmashell",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?polkit-kde-authentication-agent-1",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kded6",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kcalc",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?kfind",
        "tile": true
    },
    {
        "class": "(org\\\\.kde\\\\.)?kruler",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?krunner",
        "tile": false
    },
    {
        "class": "(org\\\\.kde\\\\.)?yakuake",
        "tile": false
    },
    {
        "class": "wl-copy|wl-paste",
        "caption": "wl-clipboard",
        "tile": false
    },
    {
        "class": "steam",
        "caption": "Steam Big Picture Mode",
        "tile": false
    },
    {
        "class": "zoom",
        "caption": "Zoom Cloud Meetings|zoom|zoom <2>",
        "tile": false
    },
    {
        "class": "jetbrains-.*",
        "caption": "splash",
        "tile": false
    },
    {
        "class": "jetbrains-.*",
        "caption": "Unstash Changes|Paths Affected by stash@.*",
        "tile": true
    }
]`;

const configDef = [
    {
        name: "gapsOuterTop",
        type: "UInt",
        default: 0,
    },
    {
        name: "gapsOuterBottom",
        type: "UInt",
        default: 0,
    },
    {
        name: "gapsOuterLeft",
        type: "UInt",
        default: 0,
    },
    {
        name: "gapsOuterRight",
        type: "UInt",
        default: 0,
    },
    {
        name: "gapsInnerHorizontal",
        type: "UInt",
        default: 4,
    },
    {
        name: "gapsInnerVertical",
        type: "UInt",
        default: 4,
    },
    {
        name: "stackOffsetX",
        type: "UInt",
        default: 8,
    },
    {
        name: "stackOffsetY",
        type: "UInt",
        default: 32,
    },
    {
        name: "manualScrollStep",
        type: "UInt",
        default: 200,
    },
    {
        name: "presetWidths",
        type: "String",
        default: "100%, 50%, 33.33%, 25%",
    },
    {
        name: "verticalResizeStep",
        type: "UInt",
        default: 32,
    },
    {
        name: "offScreenOpacity",
        type: "UInt",
        default: 100,
    },
    {
        name: "untileOnDrag",
        type: "Bool",
        default: false,
    },
    {
        name: "cursorFollowsFocus",
        type: "Bool",
        default: false,
    },
    {
        name: "stackColumnsByDefault",
        type: "Bool",
        default: false,
    },
    {
        name: "resizeNeighborColumn",
        type: "Bool",
        default: false,
    },
    {
        name: "reMaximize",
        type: "Bool",
        default: true,
    },
    {
        name: "skipSwitcher",
        type: "Bool",
        default: false,
    },
    {
        name: "scrollingLazy",
        type: "Bool",
        default: true,
    },
    {
        name: "scrollingCentered",
        type: "Bool",
        default: false,
    },
    {
        name: "scrollingGrouped",
        type: "Bool",
        default: false,
    },
    {
        name: "gestureScroll",
        type: "Bool",
        default: true,
    },
    {
        name: "gestureScrollInvert",
        type: "Bool",
        default: false,
    },
    {
        name: "gestureScrollStep",
        type: "UInt",
        default: 1920,
    },
    {
        name: "tiledKeepBelow",
        type: "Bool",
        default: false,
    },
    {
        name: "floatingKeepAbove",
        type: "Bool",
        default: false,
    },
    {
        name: "noLayering",
        type: "Bool",
        default: true,
    },
    {
        name: "windowRules",
        type: "String",
        default: defaultWindowRules,
    },
    {
        name: "tiledDesktops",
        type: "String",
        default: ".*",
    },
    {
        name: "autoTileAtEdges",
        type: "Bool",
        default: false,
    },
    {
        name: "focusRingEnabled",
        type: "Bool",
        default: true,
    },
    {
        name: "focusRingColor",
        type: "String",
        default: "#FFD700",
    },
    {
        name: "focusRingWidth",
        type: "UInt",
        default: 3,
    },
];
