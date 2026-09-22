"use strict";
function initWorkspaceSignalHandlers(world, focusPasser) {
    const manager = new SignalManager();
    manager.connect(Workspace.windowAdded, (kwinClient) => {
        world.do((clientManager, desktopManager) => {
            clientManager.addClient(kwinClient);
        });
    });
    manager.connect(Workspace.windowRemoved, (kwinClient) => {
        world.do((clientManager, desktopManager) => {
            clientManager.removeClient(kwinClient, 1 /* FocusPassing.Type.Immediate */);
        });
    });
    manager.connect(Workspace.windowActivated, (kwinClient) => {
        if (kwinClient === null) {
            focusPasser.activate();
        }
        else {
            focusPasser.clearIfDifferent(kwinClient);
            world.do((clientManager, desktopManager) => {
                clientManager.onClientFocused(kwinClient);
            });
        }
    });
    manager.connect(Workspace.currentDesktopChanged, () => {
        world.do(() => { }); // re-arrange desktop
    });
    manager.connect(Workspace.currentActivityChanged, () => {
        world.do(() => { }); // re-arrange desktop
    });
    manager.connect(Workspace.screensChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.selectScreen(Workspace.activeScreen);
        });
    });
    manager.connect(Workspace.activitiesChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateActivities();
        });
    });
    manager.connect(Workspace.desktopsChanged, () => {
        world.do((clientManager, desktopManager) => {
            desktopManager.updateDesktops();
        });
    });
    manager.connect(Workspace.virtualScreenSizeChanged, () => {
        world.onScreenResized();
    });
    return manager;
}
class PresetWidths {
    constructor(presetWidths, spacing) {
        this.presets = PresetWidths.parsePresetWidths(presetWidths, spacing);
    }
    next(currentWidth, minWidth, maxWidth, tilingAreaWidth) {
        const widths = this.getWidths(minWidth, maxWidth, tilingAreaWidth);
        const nextIndex = widths.findIndex(width => width > currentWidth);
        return nextIndex >= 0 ? widths[nextIndex] : widths[0];
    }
    prev(currentWidth, minWidth, maxWidth, tilingAreaWidth) {
        const widths = this.getWidths(minWidth, maxWidth, tilingAreaWidth).reverse();
        const nextIndex = widths.findIndex(width => width < currentWidth);
        return nextIndex >= 0 ? widths[nextIndex] : widths[0];
    }
    getWidths(minWidth, maxWidth, tilingAreaWidth) {
        const widths = this.presets.map(f => clamp(f(tilingAreaWidth), minWidth, maxWidth));
        widths.sort((a, b) => a - b);
        return uniq(widths);
    }
    static parsePresetWidths(presetWidths, spacing) {
        function getRatioFunction(ratio) {
            return (tilingAreaWidth) => Math.floor((tilingAreaWidth + spacing) * ratio - spacing);
        }
        return presetWidths.split(",").map((widthStr) => {
            widthStr = widthStr.trim();
            const widthPx = PresetWidths.parseNumberWithSuffix(widthStr, "px");
            if (widthPx !== undefined) {
                return () => widthPx;
            }
            const widthPct = PresetWidths.parseNumberWithSuffix(widthStr, "%");
            if (widthPct !== undefined) {
                return getRatioFunction(widthPct / 100.0);
            }
            return getRatioFunction(PresetWidths.parseNumberSafe(widthStr));
        });
    }
    static parseNumberSafe(str) {
        const num = Number(str);
        if (isNaN(num) || num <= 0) {
            throw new Error("Invalid number: " + str);
        }
        return num;
    }
    static parseNumberWithSuffix(str, suffix) {
        if (!str.endsWith(suffix)) {
            return undefined;
        }
        return PresetWidths.parseNumberSafe(str.substring(0, str.length - suffix.length).trim());
    }
}
class ContextualResizer {
    constructor(presetWidths) {
        this.presetWidths = presetWidths;
    }
    increaseWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const visibleRange = desktop.getCurrentVisibleRange();
        const minWidth = column.getMinWidth();
        const maxWidth = column.getMaxWidth();
        if (!Range.contains(visibleRange, column) || column.getWidth() >= maxWidth) {
            return;
        }
        const leftVisibleColumn = grid.getLeftmostVisibleColumn(visibleRange);
        const rightVisibleColumn = grid.getRightmostVisibleColumn(visibleRange);
        if (leftVisibleColumn === null || rightVisibleColumn === null) {
            console.assert(false); // should at least see self
            return;
        }
        const leftSpace = leftVisibleColumn.getLeft() - visibleRange.getLeft();
        const rightSpace = visibleRange.getRight() - rightVisibleColumn.getRight();
        const newWidth = findMinPositive([
            column.getWidth() + leftSpace + rightSpace,
            column.getWidth() + leftSpace + rightSpace + leftVisibleColumn.getWidth() + grid.config.gapsInnerHorizontal,
            column.getWidth() + leftSpace + rightSpace + rightVisibleColumn.getWidth() + grid.config.gapsInnerHorizontal,
            ...this.presetWidths.getWidths(minWidth, maxWidth, desktop.tilingArea.width),
        ], width => width - column.getWidth());
        if (newWidth === undefined) {
            return;
        }
        column.setWidth(newWidth, true);
        desktop.scrollCenterVisible(column);
    }
    decreaseWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const visibleRange = desktop.getCurrentVisibleRange();
        const minWidth = column.getMinWidth();
        const maxWidth = column.getMaxWidth();
        if (!Range.contains(visibleRange, column) || column.getWidth() <= minWidth) {
            return;
        }
        const leftVisibleColumn = grid.getLeftmostVisibleColumn(visibleRange);
        const rightVisibleColumn = grid.getRightmostVisibleColumn(visibleRange);
        if (leftVisibleColumn === null || rightVisibleColumn === null) {
            console.assert(false); // should at least see self
            return;
        }
        let leftOffScreenColumn = grid.getLeftColumn(leftVisibleColumn);
        if (leftOffScreenColumn === column) {
            leftOffScreenColumn = null;
        }
        let rightOffScreenColumn = grid.getRightColumn(rightVisibleColumn);
        if (rightOffScreenColumn === column) {
            rightOffScreenColumn = null;
        }
        const visibleColumnsWidth = rightVisibleColumn.getRight() - leftVisibleColumn.getLeft();
        const unusedWidth = visibleRange.getWidth() - visibleColumnsWidth;
        const leftOffScreen = leftOffScreenColumn === null ? 0 : leftOffScreenColumn.getWidth() + grid.config.gapsInnerHorizontal - unusedWidth;
        const rightOffScreen = rightOffScreenColumn === null ? 0 : rightOffScreenColumn.getWidth() + grid.config.gapsInnerHorizontal - unusedWidth;
        const newWidth = findMinPositive([
            column.getWidth() - leftOffScreen,
            column.getWidth() - rightOffScreen,
            ...this.presetWidths.getWidths(minWidth, maxWidth, desktop.tilingArea.width),
        ], width => column.getWidth() - width);
        if (newWidth === undefined) {
            return;
        }
        column.setWidth(newWidth, true);
        desktop.scrollCenterVisible(column);
    }
    maximizeWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const presetWidths = this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), desktop.tilingArea.width);
        const maxWidth = presetWidths[presetWidths.length - 1];
        column.setWidth(maxWidth, true);
        desktop.scrollCenterVisible(column);
    }
    minimizeWidth(column) {
        const grid = column.grid;
        const desktop = grid.desktop;
        const presetWidths = this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), desktop.tilingArea.width);
        const minWidth = presetWidths[0];
        column.setWidth(minWidth, true);
        desktop.scrollCenterVisible(column);
    }
}
class RawResizer {
    constructor(presetWidths) {
        this.presetWidths = presetWidths;
    }
    increaseWidth(column) {
        const newWidth = findMinPositive([
            ...this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), column.grid.desktop.tilingArea.width),
        ], width => width - column.getWidth());
        if (newWidth === undefined) {
            return;
        }
        column.setWidth(newWidth, true);
    }
    decreaseWidth(column) {
        const newWidth = findMinPositive([
            ...this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), column.grid.desktop.tilingArea.width),
        ], width => column.getWidth() - width);
        if (newWidth === undefined) {
            return;
        }
        column.setWidth(newWidth, true);
    }
    maximizeWidth(column) {
        const presetWidths = this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), column.grid.desktop.tilingArea.width);
        const maxWidth = presetWidths[presetWidths.length - 1];
        column.setWidth(maxWidth, true);
    }
    minimizeWidth(column) {
        const presetWidths = this.presetWidths.getWidths(column.getMinWidth(), column.getMaxWidth(), column.grid.desktop.tilingArea.width);
        const minWidth = presetWidths[0];
        column.setWidth(minWidth, true);
    }
}
class CenterClamper {
    clampScrollX(desktop, x) {
        const firstColumn = desktop.grid.getFirstColumn();
        if (firstColumn === null) {
            return 0;
        }
        const lastColumn = desktop.grid.getLastColumn();
        const minScroll = Math.round((firstColumn.getWidth() - desktop.tilingArea.width) / 2);
        const maxScroll = Math.round(desktop.grid.getWidth() - (desktop.tilingArea.width + lastColumn.getWidth()) / 2);
        return clamp(x, minScroll, maxScroll);
    }
}
class EdgeClamper {
    clampScrollX(desktop, x) {
        const minScroll = 0;
        const maxScroll = desktop.grid.getWidth() - desktop.tilingArea.width;
        if (maxScroll < 0) {
            return Math.round(maxScroll / 2);
        }
        return clamp(x, minScroll, maxScroll);
    }
}
class CenteredScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollCenterRange(column);
    }
}
class GroupedScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollCenterVisible(column);
    }
}
class InfiniteScroller {
    scrollToColumn(desktop, column) {
        // Center the column in the visible area for infinite scrolling feel
        const columnCenter = column.getLeft() + column.getWidth() / 2;
        const visibleRange = desktop.getCurrentVisibleRange();
        const visibleCenter = visibleRange.getLeft() + visibleRange.getWidth() / 2;
        // Smooth scroll to center the focused column
        const targetScrollX = columnCenter - visibleRange.getWidth() / 2;
        desktop.setScroll(targetScrollX, false);
    }
}
class LazyScroller {
    scrollToColumn(desktop, column) {
        desktop.scrollIntoView(column);
    }
}
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
        default: 16,
    },
    {
        name: "gapsOuterBottom",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsOuterLeft",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsOuterRight",
        type: "UInt",
        default: 16,
    },
    {
        name: "gapsInnerHorizontal",
        type: "UInt",
        default: 8,
    },
    {
        name: "gapsInnerVertical",
        type: "UInt",
        default: 8,
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
        default: "50%, 100%",
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
        default: true,
    },
    {
        name: "preventUntile",
        type: "Bool",
        default: true,
    },
    {
        name: "disableWindowGrouping",
        type: "Bool",
        default: false,
    },
    {
        name: "enableAnimations",
        type: "Bool",
        default: true,
    },
    {
        name: "animationDuration",
        type: "UInt",
        default: 150,
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
        default: false,
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
        name: "scrollingInfinite",
        type: "Bool",
        default: false,
    },
    {
        name: "focusFollowsMouse",
        type: "Bool",
        default: false,
    },
    {
        name: "raiseOnFocus",
        type: "Bool",
        default: true,
    },
    {
        name: "enableOverview",
        type: "Bool",
        default: true,
    },
    {
        name: "overviewScale",
        type: "UInt",
        default: 0.3,
    },
    {
        name: "gestureScroll",
        type: "Bool",
        default: false,
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
        default: true,
    },
    {
        name: "floatingKeepAbove",
        type: "Bool",
        default: false,
    },
    {
        name: "noLayering",
        type: "Bool",
        default: false,
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
        name: "enableGlowingRing",
        type: "Bool",
        default: true,
    },
    {
        name: "glowingRingColor",
        type: "String",
        default: "#63c0f9",
    },
    {
        name: "glowingRingWidth",
        type: "UInt",
        default: 3,
    },
];
class Actions {
    constructor(config) {
        this.config = config;
        this.focusLeft = (cm, dm, window, column, grid) => {
            const leftColumn = grid.getLeftColumn(column);
            if (leftColumn === null) {
                return;
            }
            leftColumn.getWindowToFocus().focus();
        };
        this.focusRight = (cm, dm, window, column, grid) => {
            const rightColumn = grid.getRightColumn(column);
            if (rightColumn === null) {
                return;
            }
            rightColumn.getWindowToFocus().focus();
        };
        this.focusUp = (cm, dm, window, column, grid) => {
            const aboveWindow = column.getAboveWindow(window);
            if (aboveWindow === null) {
                return;
            }
            aboveWindow.focus();
        };
        this.focusDown = (cm, dm, window, column, grid) => {
            const belowWindow = column.getBelowWindow(window);
            if (belowWindow === null) {
                return;
            }
            belowWindow.focus();
        };
        this.focusNext = (cm, dm, window, column, grid) => {
            const belowWindow = column.getBelowWindow(window);
            if (belowWindow !== null) {
                belowWindow.focus();
            }
            else {
                const rightColumn = grid.getRightColumn(column);
                if (rightColumn === null) {
                    return;
                }
                rightColumn.getFirstWindow().focus();
            }
        };
        this.focusPrevious = (cm, dm, window, column, grid) => {
            const aboveWindow = column.getAboveWindow(window);
            if (aboveWindow !== null) {
                aboveWindow.focus();
            }
            else {
                const leftColumn = grid.getLeftColumn(column);
                if (leftColumn === null) {
                    return;
                }
                leftColumn.getLastWindow().focus();
            }
        };
        this.focusStart = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const firstColumn = grid.getFirstColumn();
            if (firstColumn === null) {
                return;
            }
            firstColumn.getWindowToFocus().focus();
        };
        this.focusEnd = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const lastColumn = grid.getLastColumn();
            if (lastColumn === null) {
                return;
            }
            lastColumn.getWindowToFocus().focus();
        };
        this.windowMoveLeft = (cm, dm, window, column, grid) => {
            if (column.getWindowCount() === 1) {
                // move from own column into existing column
                const leftColumn = grid.getLeftColumn(column);
                if (leftColumn === null) {
                    return;
                }
                window.moveToColumn(leftColumn, true, 0 /* FocusPassing.Type.None */);
                grid.desktop.autoAdjustScroll();
            }
            else {
                // move from shared column into own column
                const newColumn = new Column(grid, grid.getLeftColumn(column));
                window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
            }
        };
        this.windowMoveRight = (cm, dm, window, column, grid, bottom = true) => {
            if (column.getWindowCount() === 1) {
                // move from own column into existing column
                const rightColumn = grid.getRightColumn(column);
                if (rightColumn === null) {
                    return;
                }
                window.moveToColumn(rightColumn, bottom, 0 /* FocusPassing.Type.None */);
                grid.desktop.autoAdjustScroll();
            }
            else {
                // move from shared column into own column
                const newColumn = new Column(grid, column);
                window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
            }
        };
        // TODO (optimization): only arrange moved windows
        this.windowMoveUp = (cm, dm, window, column, grid) => {
            column.moveWindowUp(window);
        };
        // TODO (optimization): only arrange moved windows
        this.windowMoveDown = (cm, dm, window, column, grid) => {
            column.moveWindowDown(window);
        };
        this.windowMoveNext = (cm, dm, window, column, grid) => {
            const canMoveDown = window !== column.getLastWindow();
            if (canMoveDown) {
                column.moveWindowDown(window);
            }
            else {
                this.windowMoveRight(cm, dm, window, column, grid, false);
            }
        };
        this.windowMovePrevious = (cm, dm, window, column, grid) => {
            const canMoveUp = window !== column.getFirstWindow();
            if (canMoveUp) {
                column.moveWindowUp(window);
            }
            else {
                this.windowMoveLeft(cm, dm, window, column, grid);
            }
        };
        this.windowMoveStart = (cm, dm, window, column, grid) => {
            const newColumn = new Column(grid, null);
            window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
        };
        this.windowMoveEnd = (cm, dm, window, column, grid) => {
            const newColumn = new Column(grid, grid.getLastColumn());
            window.moveToColumn(newColumn, true, 0 /* FocusPassing.Type.None */);
        };
        this.windowHeightIncreaseUp = (cm, dm, window, column, grid) => {
            window.column.adjustWindowHeight(window, this.config.verticalResizeStep, true);
        };
        this.windowHeightIncreaseDown = (cm, dm, window, column, grid) => {
            window.column.adjustWindowHeight(window, this.config.verticalResizeStep, false);
        };
        this.windowToggleFloating = (cm, dm) => {
            if (Workspace.activeWindow === null) {
                return;
            }
            // Only allow floating if preventUntile is false or window rules allow it
            if (this.config.preventUntile) {
                // Show notification that untile is disabled
                return;
            }
            cm.toggleFloatingClient(Workspace.activeWindow);
        };
        this.windowToggleFullScreen = (cm, dm) => {
            if (Workspace.activeWindow === null) {
                return;
            }
            const client = cm.findTiledWindow(Workspace.activeWindow);
            if (client === null) {
                return;
            }
            const kwinClient = client.client.kwinClient;
            const isFullScreen = kwinClient.fullScreen;
            // Toggle fake fullscreen (niri-style) - keeps window tiled but fills screen
            kwinClient.fullScreen = !isFullScreen;
        };
        this.windowToggleMaximized = (cm, dm) => {
            if (Workspace.activeWindow === null) {
                return;
            }
            const client = cm.findTiledWindow(Workspace.activeWindow);
            if (client === null) {
                return;
            }
            const kwinClient = client.client.kwinClient;
            const desktop = dm.getDesktopForClient(kwinClient);
            if (!desktop)
                return;
            // Check if already maximized by script
            const isScriptMaximized = client.focusedState.maximizedMode === 3 /* MaximizedMode.Maximized */;
            if (isScriptMaximized) {
                // Restore to normal tiling
                desktop.arrange();
                client.focusedState.maximizedMode = 0 /* MaximizedMode.Unmaximized */;
            }
            else {
                // Maximize to fill available screen space (script-controlled)
                const area = desktop.tilingArea;
                client.client.place(area.x, area.y, area.width, area.height, this.config.enableAnimations);
                client.focusedState.maximizedMode = 3 /* MaximizedMode.Maximized */;
                // Disable KWin's native maximize to let script control it
                kwinClient.setMaximize(false, false);
            }
        };
        this.windowFloatToggle = (cm, dm) => {
            if (Workspace.activeWindow === null) {
                return;
            }
            // Meta+Space: detach from tiling and float
            cm.toggleFloatingClient(Workspace.activeWindow);
        };
        this.windowMaximize = (cm, dm) => {
            if (Workspace.activeWindow === null) {
                return;
            }
            const window = cm.findTiledWindow(Workspace.activeWindow);
            if (window === null) {
                return;
            }
            // Niri-style maximize: fill entire screen while staying tiled
            const kwinClient = window.client.kwinClient;
            const screenGeo = Workspace.clientArea(4 /* ClientAreaOption.FullScreenArea */, Workspace.activeScreen, kwinClient.desktops[0]);
            window.client.place(screenGeo.x, screenGeo.y, screenGeo.width, screenGeo.height);
        };
        this.toggleOverview = (cm, dm) => {
            // Show overview of all columns/windows (niri-expose like)
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            // Trigger overview mode - this would need UI integration
            // For now, center view on all columns
            desktop.grid.arrange(desktop.tilingArea.x - desktop.getScrollX(), desktop.getCurrentVisibleRange());
        };
        this.columnMoveLeft = (cm, dm, window, column, grid) => {
            grid.moveColumnLeft(column);
        };
        this.columnMoveRight = (cm, dm, window, column, grid) => {
            grid.moveColumnRight(column);
        };
        this.columnMoveStart = (cm, dm, window, column, grid) => {
            grid.moveColumn(column, null);
        };
        this.columnMoveEnd = (cm, dm, window, column, grid) => {
            grid.moveColumn(column, grid.getLastColumn());
        };
        this.columnToggleStacked = (cm, dm, window, column, grid) => {
            column.toggleStacked();
        };
        this.columnWidthIncrease = (cm, dm, window, column, grid) => {
            this.config.columnResizer.increaseWidth(column);
        };
        this.columnWidthDecrease = (cm, dm, window, column, grid) => {
            this.config.columnResizer.decreaseWidth(column);
        };
        this.columnWidthMaximize = (cm, dm, window, column, grid) => {
            this.config.columnResizer.maximizeWidth(column);
        };
        this.columnWidthMinimize = (cm, dm, window, column, grid) => {
            this.config.columnResizer.minimizeWidth(column);
        };
        this.cyclePresetWidths = (cm, dm, window, column, grid) => {
            const nextWidth = this.config.presetWidths.next(column.getWidth(), column.getMinWidth(), column.getMaxWidth(), grid.desktop.tilingArea.width);
            column.setWidth(nextWidth, true);
        };
        this.cyclePresetWidthsReverse = (cm, dm, window, column, grid) => {
            const nextWidth = this.config.presetWidths.prev(column.getWidth(), column.getMinWidth(), column.getMaxWidth(), grid.desktop.tilingArea.width);
            column.setWidth(nextWidth, true);
        };
        this.columnsWidthEqualize = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const visibleRange = desktop.getCurrentVisibleRange();
            const visibleColumns = Array.from(desktop.grid.getVisibleColumns(visibleRange));
            const availableSpace = desktop.tilingArea.width;
            const gapsWidth = desktop.grid.config.gapsInnerHorizontal * (visibleColumns.length - 1);
            const widths = fillSpace(availableSpace - gapsWidth, visibleColumns.map(column => ({ min: column.getMinWidth(), max: column.getMaxWidth() })));
            visibleColumns.forEach((column, index) => column.setWidth(widths[index], true));
            desktop.scrollCenterRange(Range.fromRanges(visibleColumns[0], visibleColumns[visibleColumns.length - 1]));
        };
        this.columnsSqueezeLeft = (cm, dm, window, focusedColumn, grid) => {
            const visibleRange = grid.desktop.getCurrentVisibleRange();
            if (!Range.contains(visibleRange, focusedColumn)) {
                return;
            }
            const currentVisibleColumns = Array.from(grid.getVisibleColumns(visibleRange));
            console.assert(currentVisibleColumns.includes(focusedColumn), "should at least contain the focused column");
            const targetColumn = grid.getLeftColumn(currentVisibleColumns[0]);
            if (targetColumn === null) {
                return;
            }
            const wantedVisibleColumns = [targetColumn, ...currentVisibleColumns];
            while (true) {
                const success = this.squeezeColumns(wantedVisibleColumns);
                if (success) {
                    break;
                }
                const removedColumn = wantedVisibleColumns.pop();
                if (removedColumn === focusedColumn) {
                    break; // don't scroll past the currently focused column
                }
            }
        };
        this.columnsSqueezeRight = (cm, dm, window, focusedColumn, grid) => {
            const visibleRange = grid.desktop.getCurrentVisibleRange();
            if (!Range.contains(visibleRange, focusedColumn)) {
                return;
            }
            const currentVisibleColumns = Array.from(grid.getVisibleColumns(visibleRange));
            console.assert(currentVisibleColumns.includes(focusedColumn), "should at least contain the focused column");
            const targetColumn = grid.getRightColumn(currentVisibleColumns[currentVisibleColumns.length - 1]);
            if (targetColumn === null) {
                return;
            }
            const wantedVisibleColumns = [...currentVisibleColumns, targetColumn];
            while (true) {
                const success = this.squeezeColumns(wantedVisibleColumns);
                if (success) {
                    break;
                }
                const removedColumn = wantedVisibleColumns.shift();
                if (removedColumn === focusedColumn) {
                    break; // don't scroll past the currently focused column
                }
            }
        };
        this.squeezeColumns = (columns) => {
            const firstColumn = columns[0];
            const lastColumn = columns[columns.length - 1];
            const grid = firstColumn.grid;
            const desktop = grid.desktop;
            const availableSpace = desktop.tilingArea.width;
            const gapsWidth = grid.config.gapsInnerHorizontal * (columns.length - 1);
            const columnConstraints = columns.map(column => ({ min: column.getMinWidth(), max: column.getWidth() }));
            const minTotalWidth = gapsWidth + columnConstraints.reduce((acc, constraint) => acc + constraint.min, 0);
            if (minTotalWidth > availableSpace) {
                // there's nothing we can do
                return false;
            }
            const widths = fillSpace(availableSpace - gapsWidth, columnConstraints);
            columns.forEach((column, index) => column.setWidth(widths[index], true));
            desktop.scrollCenterRange(Range.fromRanges(firstColumn, lastColumn));
            return true;
        };
        this.gridScrollLeft = (cm, dm) => {
            this.gridScroll(dm, -this.config.manualScrollStep);
        };
        this.gridScrollRight = (cm, dm) => {
            this.gridScroll(dm, this.config.manualScrollStep);
        };
        this.gridScroll = (desktopManager, amount) => {
            const desktop = desktopManager.getCurrentDesktop();
            if (desktop !== undefined) {
                desktop.adjustScroll(amount, false);
            }
        };
        this.gridScrollStart = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const firstColumn = grid.getFirstColumn();
            if (firstColumn === null) {
                return;
            }
            grid.desktop.scrollToColumn(firstColumn, false);
        };
        this.gridScrollEnd = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const lastColumn = grid.getLastColumn();
            if (lastColumn === null) {
                return;
            }
            grid.desktop.scrollToColumn(lastColumn, false);
        };
        this.gridScrollFocused = (cm, dm, window, column, grid) => {
            const scrollAmount = Range.minus(column, grid.desktop.getCurrentVisibleRange());
            if (scrollAmount !== 0) {
                grid.desktop.adjustScroll(scrollAmount, true);
            }
            else {
                grid.desktop.scrollToColumn(column, true);
            }
        };
        this.gridScrollLeftColumn = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const column = grid.getLeftmostVisibleColumn(grid.desktop.getCurrentVisibleRange());
            if (column === null) {
                return;
            }
            const leftColumn = grid.getLeftColumn(column);
            if (leftColumn === null) {
                return;
            }
            grid.desktop.scrollToColumn(leftColumn, false);
        };
        this.gridScrollRightColumn = (cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const column = grid.getRightmostVisibleColumn(grid.desktop.getCurrentVisibleRange());
            if (column === null) {
                return;
            }
            const rightColumn = grid.getRightColumn(column);
            if (rightColumn === null) {
                return;
            }
            grid.desktop.scrollToColumn(rightColumn, false);
        };
        this.screenSwitch = (cm, dm) => {
            dm.selectScreen(Workspace.activeScreen);
        };
        this.focus = (columnIndex, cm, dm) => {
            const desktop = dm.getCurrentDesktop();
            if (desktop === undefined) {
                return;
            }
            const grid = desktop.grid;
            const targetColumn = grid.getColumnAtIndex(columnIndex);
            if (targetColumn === null) {
                return;
            }
            targetColumn.getWindowToFocus().focus();
        };
        this.windowMoveToColumn = (columnIndex, cm, dm, window, column, grid) => {
            const targetColumn = grid.getColumnAtIndex(columnIndex);
            if (targetColumn === null) {
                return;
            }
            window.moveToColumn(targetColumn, true, 0 /* FocusPassing.Type.None */);
            grid.desktop.autoAdjustScroll();
        };
        this.columnMoveToColumn = (columnIndex, cm, dm, window, column, grid) => {
            const targetColumn = grid.getColumnAtIndex(columnIndex);
            if (targetColumn === null || targetColumn === column) {
                return;
            }
            if (targetColumn.isToTheRightOf(column)) {
                grid.moveColumn(column, targetColumn);
            }
            else {
                grid.moveColumn(column, grid.getLeftColumn(targetColumn));
            }
        };
        this.columnMoveToDesktop = (desktopIndex, cm, dm, window, column, oldGrid) => {
            const kwinDesktop = Workspace.desktops[desktopIndex];
            if (kwinDesktop === undefined) {
                return;
            }
            const newDesktop = dm.getDesktopInCurrentActivity(kwinDesktop);
            if (newDesktop === undefined) {
                return;
            }
            const newGrid = newDesktop.grid;
            if (newGrid === null || newGrid === oldGrid) {
                return;
            }
            column.moveToGrid(newGrid, newGrid.getLastColumn());
        };
        this.columnMoveToNextDesktop = (cm, dm, window, column, oldGrid) => {
            const currentDesktopIndex = Workspace.desktops.indexOf(oldGrid.desktop.kwinDesktop);
            if (currentDesktopIndex < 0) {
                return;
            }
            const targetDesktopIndex = currentDesktopIndex + 1;
            if (targetDesktopIndex >= Workspace.desktops.length) {
                return;
            }
            this.columnMoveToDesktop(targetDesktopIndex, cm, dm, window, column, oldGrid);
        };
        this.columnMoveToPreviousDesktop = (cm, dm, window, column, oldGrid) => {
            const currentDesktopIndex = Workspace.desktops.indexOf(oldGrid.desktop.kwinDesktop);
            const targetDesktopIndex = currentDesktopIndex - 1;
            if (targetDesktopIndex < 0) {
                return;
            }
            this.columnMoveToDesktop(targetDesktopIndex, cm, dm, window, column, oldGrid);
        };
        this.tailMoveToDesktop = (desktopIndex, cm, dm, window, column, oldGrid) => {
            const kwinDesktop = Workspace.desktops[desktopIndex];
            if (kwinDesktop === undefined) {
                return;
            }
            const newDesktop = dm.getDesktopInCurrentActivity(kwinDesktop);
            if (newDesktop === undefined) {
                return;
            }
            const newGrid = newDesktop.grid;
            if (newGrid === null || newGrid === oldGrid) {
                return;
            }
            oldGrid.evacuateTail(newGrid, column);
        };
        this.tailMoveToNextDesktop = (cm, dm, window, column, oldGrid) => {
            const currentDesktopIndex = Workspace.desktops.indexOf(oldGrid.desktop.kwinDesktop);
            if (currentDesktopIndex < 0) {
                return;
            }
            const targetDesktopIndex = currentDesktopIndex + 1;
            if (targetDesktopIndex >= Workspace.desktops.length) {
                return;
            }
            this.tailMoveToDesktop(targetDesktopIndex, cm, dm, window, column, oldGrid);
        };
        this.tailMoveToPreviousDesktop = (cm, dm, window, column, oldGrid) => {
            const currentDesktopIndex = Workspace.desktops.indexOf(oldGrid.desktop.kwinDesktop);
            const targetDesktopIndex = currentDesktopIndex - 1;
            if (targetDesktopIndex < 0) {
                return;
            }
            this.tailMoveToDesktop(targetDesktopIndex, cm, dm, window, column, oldGrid);
        };
    }
}
function getKeyBindings(world, actions) {
    return [
        {
            name: "window-toggle-floating",
            description: "Toggle floating (detach from tiling)",
            defaultKeySequence: "Meta+Shift+Space",
            action: () => world.do(actions.windowToggleFloating),
        },
        {
            name: "window-float-toggle",
            description: "Float window (Meta+Space)",
            defaultKeySequence: "Meta+Space",
            action: () => world.do(actions.windowFloatToggle),
        },
        {
            name: "window-toggle-fullscreen",
            description: "Toggle fake fullscreen (niri-style)",
            defaultKeySequence: "Meta+F",
            action: () => world.doIfTiledFocused(actions.windowToggleFullScreen),
        },
        {
            name: "window-toggle-maximized",
            description: "Toggle script-controlled maximize (50% <-> 100%)",
            defaultKeySequence: "Meta+Ctrl+F",
            action: () => world.doIfTiledFocused(actions.windowToggleMaximized),
        },
        {
            name: "toggle-overview",
            description: "Toggle overview/expose view",
            defaultKeySequence: "Meta+Tab",
            action: () => world.do(actions.toggleOverview),
        },
        {
            name: "focus-left",
            description: "Move focus left",
            defaultKeySequence: "Meta+A",
            action: () => world.doIfTiledFocused(actions.focusLeft),
        },
        {
            name: "focus-right",
            description: "Move focus right",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+D",
            action: () => world.doIfTiledFocused(actions.focusRight),
        },
        {
            name: "focus-up",
            description: "Move focus up",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+W",
            action: () => world.doIfTiledFocused(actions.focusUp),
        },
        {
            name: "focus-down",
            description: "Move focus down",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+S",
            action: () => world.doIfTiledFocused(actions.focusDown),
        },
        {
            name: "focus-next",
            description: "Move focus to the next window in grid",
            action: () => world.doIfTiledFocused(actions.focusNext),
        },
        {
            name: "focus-previous",
            description: "Move focus to the previous window in grid",
            action: () => world.doIfTiledFocused(actions.focusPrevious),
        },
        {
            name: "focus-start",
            description: "Move focus to start",
            defaultKeySequence: "Meta+Home",
            action: () => world.do(actions.focusStart),
        },
        {
            name: "focus-end",
            description: "Move focus to end",
            defaultKeySequence: "Meta+End",
            action: () => world.do(actions.focusEnd),
        },
        {
            name: "window-move-left",
            description: "Move window left",
            comment: "Moves window out of and into columns",
            defaultKeySequence: "Meta+Shift+A",
            action: () => world.doIfTiledFocused(actions.windowMoveLeft),
        },
        {
            name: "window-move-right",
            description: "Move window right",
            comment: "Moves window out of and into columns",
            defaultKeySequence: "Meta+Shift+D",
            action: () => world.doIfTiledFocused(actions.windowMoveRight),
        },
        {
            name: "window-move-up",
            description: "Move window up",
            defaultKeySequence: "Meta+Shift+W",
            action: () => world.doIfTiledFocused(actions.windowMoveUp),
        },
        {
            name: "window-move-down",
            description: "Move window down",
            defaultKeySequence: "Meta+Shift+S",
            action: () => world.doIfTiledFocused(actions.windowMoveDown),
        },
        {
            name: "window-move-next",
            description: "Move window to the next position in grid",
            action: () => world.doIfTiledFocused(actions.windowMoveNext),
        },
        {
            name: "window-move-previous",
            description: "Move window to the previous position in grid",
            action: () => world.doIfTiledFocused(actions.windowMovePrevious),
        },
        {
            name: "window-move-start",
            description: "Move window to start",
            defaultKeySequence: "Meta+Shift+Home",
            action: () => world.doIfTiledFocused(actions.windowMoveStart),
        },
        {
            name: "window-move-end",
            description: "Move window to end",
            defaultKeySequence: "Meta+Shift+End",
            action: () => world.doIfTiledFocused(actions.windowMoveEnd),
        },
        {
            name: "window-height-increase-up",
            description: "Increase window height upwards",
            action: () => world.doIfTiledFocused(actions.windowHeightIncreaseUp),
        },
        {
            name: "window-height-increase-down",
            description: "Increase window height downwards",
            action: () => world.doIfTiledFocused(actions.windowHeightIncreaseDown),
        },
        {
            name: "column-toggle-stacked",
            description: "Toggle stacked layout for focused column",
            comment: "Only the active window visible",
            defaultKeySequence: "Meta+X",
            action: () => world.doIfTiledFocused(actions.columnToggleStacked),
        },
        {
            name: "column-move-left",
            description: "Move column left",
            defaultKeySequence: "Meta+Ctrl+Shift+A",
            action: () => world.doIfTiledFocused(actions.columnMoveLeft),
        },
        {
            name: "column-move-right",
            description: "Move column right",
            defaultKeySequence: "Meta+Ctrl+Shift+D",
            action: () => world.doIfTiledFocused(actions.columnMoveRight),
        },
        {
            name: "column-move-start",
            description: "Move column to start",
            defaultKeySequence: "Meta+Ctrl+Shift+Home",
            action: () => world.doIfTiledFocused(actions.columnMoveStart),
        },
        {
            name: "column-move-end",
            description: "Move column to end",
            defaultKeySequence: "Meta+Ctrl+Shift+End",
            action: () => world.doIfTiledFocused(actions.columnMoveEnd),
        },
        {
            name: "column-move-to-next-desktop",
            description: "Move column to the next desktop",
            action: () => world.doIfTiledFocused(actions.columnMoveToNextDesktop),
        },
        {
            name: "column-move-to-previous-desktop",
            description: "Move column to the previous desktop",
            action: () => world.doIfTiledFocused(actions.columnMoveToPreviousDesktop),
        },
        {
            name: "column-width-increase",
            description: "Increase column width",
            defaultKeySequence: "Meta+Ctrl++",
            action: () => world.doIfTiledFocused(actions.columnWidthIncrease),
        },
        {
            name: "column-width-decrease",
            description: "Decrease column width",
            defaultKeySequence: "Meta+Ctrl+-",
            action: () => world.doIfTiledFocused(actions.columnWidthDecrease),
        },
        {
            name: "column-width-maximize",
            description: "Increase column width to maximum",
            action: () => world.doIfTiledFocused(actions.columnWidthMaximize),
        },
        {
            name: "column-width-minimize",
            description: "Decrease column width to minimum",
            action: () => world.doIfTiledFocused(actions.columnWidthMinimize),
        },
        {
            name: "cycle-preset-widths",
            description: "Cycle through preset column widths",
            defaultKeySequence: "Meta+R",
            action: () => world.doIfTiledFocused(actions.cyclePresetWidths),
        },
        {
            name: "cycle-preset-widths-reverse",
            description: "Cycle through preset column widths in reverse",
            defaultKeySequence: "Meta+Shift+R",
            action: () => world.doIfTiledFocused(actions.cyclePresetWidthsReverse),
        },
        {
            name: "columns-width-equalize",
            description: "Equalize widths of visible columns",
            defaultKeySequence: "Meta+Ctrl+X",
            action: () => world.do(actions.columnsWidthEqualize),
        },
        {
            name: "columns-squeeze-left",
            description: "Squeeze left column onto the screen",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultKeySequence: "Meta+Ctrl+A",
            action: () => world.doIfTiledFocused(actions.columnsSqueezeLeft),
        },
        {
            name: "columns-squeeze-right",
            description: "Squeeze right column onto the screen",
            defaultKeySequence: "Meta+Ctrl+D",
            action: () => world.doIfTiledFocused(actions.columnsSqueezeRight),
        },
        {
            name: "grid-scroll-focused",
            description: "Center focused window",
            comment: "Scrolls so that the focused window is centered in the screen",
            defaultKeySequence: "Meta+Alt+Return",
            action: () => world.doIfTiledFocused(actions.gridScrollFocused),
        },
        {
            name: "grid-scroll-left-column",
            description: "Scroll one column to the left",
            defaultKeySequence: "Meta+Alt+A",
            action: () => world.do(actions.gridScrollLeftColumn),
        },
        {
            name: "grid-scroll-right-column",
            description: "Scroll one column to the right",
            defaultKeySequence: "Meta+Alt+D",
            action: () => world.do(actions.gridScrollRightColumn),
        },
        {
            name: "grid-scroll-left",
            description: "Scroll left",
            defaultKeySequence: "Meta+Alt+PgUp",
            action: () => world.do(actions.gridScrollLeft),
        },
        {
            name: "grid-scroll-right",
            description: "Scroll right",
            defaultKeySequence: "Meta+Alt+PgDown",
            action: () => world.do(actions.gridScrollRight),
        },
        {
            name: "grid-scroll-start",
            description: "Scroll to start",
            defaultKeySequence: "Meta+Alt+Home",
            action: () => world.do(actions.gridScrollStart),
        },
        {
            name: "grid-scroll-end",
            description: "Scroll to end",
            defaultKeySequence: "Meta+Alt+End",
            action: () => world.do(actions.gridScrollEnd),
        },
        {
            name: "screen-switch",
            description: "Move Karousel grid to the current screen",
            defaultKeySequence: "Meta+Ctrl+Return",
            action: () => world.do(actions.screenSwitch),
        },
        {
            name: "tail-move-to-next-desktop",
            description: "Move this and all following columns to the next desktop",
            action: () => world.doIfTiledFocused(actions.tailMoveToNextDesktop),
        },
        {
            name: "tail-move-to-previous-desktop",
            description: "Move this and all following columns to the previous desktop",
            action: () => world.doIfTiledFocused(actions.tailMoveToPreviousDesktop),
        },
    ];
}
function getNumKeyBindings(world, actions) {
    return [
        {
            name: "focus-{}",
            description: "Move focus to column {}",
            comment: "Clashes with default KDE shortcuts, may require manual remapping",
            defaultModifiers: "Meta",
            fKeys: false,
            action: (i) => world.do(actions.focus.partial(i)),
        },
        {
            name: "window-move-to-column-{}",
            description: "Move window to column {}",
            comment: "Requires manual remapping according to your keyboard layout, e.g. Meta+Shift+1 -> Meta+!",
            defaultModifiers: "Meta+Shift",
            fKeys: false,
            action: (i) => world.doIfTiledFocused(actions.windowMoveToColumn.partial(i)),
        },
        {
            name: "column-move-to-column-{}",
            description: "Move column to position {}",
            comment: "Requires manual remapping according to your keyboard layout, e.g. Meta+Ctrl+Shift+1 -> Meta+Ctrl+!",
            defaultModifiers: "Meta+Ctrl+Shift",
            fKeys: false,
            action: (i) => world.doIfTiledFocused(actions.columnMoveToColumn.partial(i)),
        },
        {
            name: "column-move-to-desktop-{}",
            description: "Move column to desktop {}",
            defaultModifiers: "Meta+Ctrl+Shift",
            fKeys: true,
            action: (i) => world.doIfTiledFocused(actions.columnMoveToDesktop.partial(i)),
        },
        {
            name: "tail-move-to-desktop-{}",
            description: "Move this and all following columns to desktop {}",
            defaultModifiers: "Meta+Ctrl+Shift+Alt",
            fKeys: true,
            action: (i) => world.doIfTiledFocused(actions.tailMoveToDesktop.partial(i)),
        },
    ];
}
function catchWrap(f) {
    return () => {
        try {
            f();
        }
        catch (error) {
            log(error);
            log(error.stack);
        }
    };
}
function registerKeyBinding(shortcutActions, keyBinding) {
    shortcutActions.push(new ShortcutAction(keyBinding, catchWrap(keyBinding.action)));
}
function registerNumKeyBindings(shortcutActions, numKeyBinding) {
    const numPrefix = numKeyBinding.fKeys ? "F" : "";
    const n = numKeyBinding.fKeys ? 12 : 9;
    for (let i = 0; i < 12; i++) {
        const numKey = String(i + 1);
        const keySequence = i < n ?
            numKeyBinding.defaultModifiers + "+" + numPrefix + numKey :
            "";
        shortcutActions.push(new ShortcutAction({
            name: applyMacro(numKeyBinding.name, numKey),
            description: applyMacro(numKeyBinding.description, numKey),
            defaultKeySequence: keySequence,
        }, catchWrap(() => numKeyBinding.action(i))));
    }
}
function registerKeyBindings(world, config) {
    const actions = new Actions(config);
    const shortcutActions = [];
    for (const keyBinding of getKeyBindings(world, actions)) {
        registerKeyBinding(shortcutActions, keyBinding);
    }
    for (const numKeyBinding of getNumKeyBindings(world, actions)) {
        registerNumKeyBindings(shortcutActions, numKeyBinding);
    }
    return shortcutActions;
}
class Column {
    constructor(grid, leftColumn) {
        this.gridX = 0;
        this.width = 0;
        this.windows = new LinkedList();
        this.stacked = grid.config.stackColumnsByDefault;
        this.focusTaker = null;
        this.grid = grid;
        this.grid.onColumnAdded(this, leftColumn);
    }
    moveToGrid(targetGrid, leftColumn) {
        if (targetGrid === this.grid) {
            this.grid.moveColumn(this, leftColumn);
        }
        else {
            this.grid.onColumnRemoved(this, this.isFocused() ? 1 /* FocusPassing.Type.Immediate */ : 0 /* FocusPassing.Type.None */);
            this.grid = targetGrid;
            targetGrid.onColumnAdded(this, leftColumn);
            for (const window of this.windows.iterator()) {
                window.client.kwinClient.desktops = [targetGrid.desktop.kwinDesktop];
            }
        }
    }
    isToTheLeftOf(other) {
        return this.gridX < other.gridX;
    }
    isToTheRightOf(other) {
        return this.gridX > other.gridX;
    }
    moveWindowUp(window) {
        this.windows.moveBack(window);
        this.grid.desktop.onLayoutChanged();
    }
    moveWindowDown(window) {
        this.windows.moveForward(window);
        this.grid.desktop.onLayoutChanged();
    }
    getWindowCount() {
        return this.windows.length();
    }
    isEmpty() {
        return this.getWindowCount() === 0;
    }
    getFirstWindow() {
        return this.windows.getFirst();
    }
    getLastWindow() {
        return this.windows.getLast();
    }
    getAboveWindow(window) {
        return this.windows.getPrev(window);
    }
    getBelowWindow(window) {
        return this.windows.getNext(window);
    }
    getWidth() {
        return this.width;
    }
    getMinWidth() {
        let maxMinWidth = Column.minWidth;
        for (const window of this.windows.iterator()) {
            const minWidth = window.client.kwinClient.minSize.width.ceil();
            if (minWidth > maxMinWidth) {
                maxMinWidth = minWidth;
            }
        }
        return Math.min(maxMinWidth, this.grid.desktop.tilingArea.width); // min width mustn't exceed tilingArea width
    }
    getMaxWidth() {
        let minMaxWidth = this.grid.desktop.tilingArea.width;
        for (const window of this.windows.iterator()) {
            const maxWidth = window.client.kwinClient.maxSize.width.floor();
            if (maxWidth < minMaxWidth) {
                minMaxWidth = maxWidth;
            }
        }
        return Math.max(minMaxWidth, this.getMinWidth()); // max width mustn't be lower than min width
    }
    setWidth(width, setPreferred) {
        width = clamp(width, this.getMinWidth(), this.getMaxWidth());
        if (width === this.width) {
            return;
        }
        this.width = width;
        if (setPreferred) {
            for (const window of this.windows.iterator()) {
                window.client.preferredWidth = width;
            }
        }
        this.grid.onColumnWidthChanged(this);
    }
    adjustWidth(widthDelta, setPreferred) {
        this.setWidth(this.width + widthDelta, setPreferred);
    }
    updateWidth() {
        let minErr = Infinity;
        let closestPreferredWidth = this.width;
        for (const window of this.windows.iterator()) {
            const err = Math.abs(window.client.preferredWidth - this.width);
            if (err < minErr) {
                minErr = err;
                closestPreferredWidth = window.client.preferredWidth;
            }
        }
        this.setWidth(closestPreferredWidth, false);
    }
    // returns x position of left edge in grid space
    getLeft() {
        return this.gridX;
    }
    // returns x position of right edge in grid space
    getRight() {
        return this.gridX + this.width;
    }
    onUserResizeWidth(startWidth, currentDelta, resizingLeftSide, neighbor) {
        const oldColumnWidth = this.getWidth();
        this.setWidth(startWidth + currentDelta, true);
        const actualDelta = this.getWidth() - startWidth;
        let leftEdgeDeltaStep = resizingLeftSide ? oldColumnWidth - this.getWidth() : 0;
        if (neighbor !== undefined) {
            const oldNeighborWidth = neighbor.column.getWidth();
            neighbor.column.setWidth(neighbor.startWidth - actualDelta, true);
            if (resizingLeftSide) {
                leftEdgeDeltaStep -= neighbor.column.getWidth() - oldNeighborWidth;
            }
        }
        this.grid.desktop.adjustScroll(-leftEdgeDeltaStep, true);
    }
    adjustWindowHeight(window, heightDelta, top) {
        const otherWindow = top ? this.windows.getPrev(window) : this.windows.getNext(window);
        if (otherWindow === null) {
            return;
        }
        window.height += heightDelta;
        otherWindow.height -= heightDelta;
        this.grid.desktop.onLayoutChanged();
    }
    resizeWindows() {
        const nWindows = this.windows.length();
        if (nWindows === 0) {
            return;
        }
        if (nWindows === 1) {
            this.stacked = this.grid.config.stackColumnsByDefault;
        }
        let remainingPixels = this.grid.desktop.tilingArea.height - (nWindows - 1) * this.grid.config.gapsInnerVertical;
        let remainingWindows = nWindows;
        for (const window of this.windows.iterator()) {
            const windowHeight = Math.round(remainingPixels / remainingWindows);
            window.height = windowHeight;
            remainingPixels -= windowHeight;
            remainingWindows--;
        }
        // TODO: respect min height
        this.grid.desktop.onLayoutChanged();
    }
    getFocusTaker() {
        if (this.focusTaker === null || !this.windows.contains(this.focusTaker)) {
            return null;
        }
        return this.focusTaker;
    }
    getWindowToFocus() {
        return this.getFocusTaker() ?? this.windows.getFirst();
    }
    isFocused() {
        const lastFocusedWindow = this.grid.getLastFocusedWindow();
        if (lastFocusedWindow === null) {
            return false;
        }
        return lastFocusedWindow.column === this && lastFocusedWindow.isFocused();
    }
    arrange(x, visibleRange, forceOpaque) {
        if (this.grid.config.offScreenOpacity < 1.0 && !forceOpaque) {
            const opacity = Range.contains(visibleRange, this) ? 100 : this.grid.config.offScreenOpacity;
            for (const window of this.windows.iterator()) {
                window.client.kwinClient.opacity = opacity;
            }
        }
        if (this.stacked && this.windows.length() >= 2) {
            this.arrangeStacked(x);
            return;
        }
        let y = this.grid.desktop.tilingArea.y;
        for (const window of this.windows.iterator()) {
            window.arrange(x, y, this.width, window.height);
            y += window.height + this.grid.config.gapsInnerVertical;
        }
    }
    arrangeStacked(x) {
        const nWindows = this.windows.length();
        const windowWidth = this.width - (nWindows - 1) * this.grid.config.stackOffsetX;
        const windowHeight = this.grid.desktop.tilingArea.height - (nWindows - 1) * this.grid.config.stackOffsetY;
        let windowX = x;
        let windowY = this.grid.desktop.tilingArea.y;
        for (const window of this.windows.iterator()) {
            window.arrange(windowX, windowY, windowWidth, windowHeight);
            windowX += this.grid.config.stackOffsetX;
            windowY += this.grid.config.stackOffsetY;
        }
        this.arrangeZ();
    }
    arrangeZ() {
        for (const window of this.windows.iterator()) {
            if (window === this.focusTaker) {
                break;
            }
            window.raise();
        }
        for (const window of this.windows.iteratorReverse()) {
            window.raise();
            if (window === this.focusTaker) {
                break;
            }
        }
    }
    toggleStacked() {
        if (this.windows.length() < 2) {
            return;
        }
        this.stacked = !this.stacked;
        this.grid.desktop.onLayoutChanged();
    }
    onWindowAdded(window, bottom) {
        if (bottom) {
            this.windows.insertEnd(window);
        }
        else {
            this.windows.insertStart(window);
        }
        if (this.width === 0) {
            this.setWidth(window.client.preferredWidth, false);
        }
        else {
            this.setWidth(this.width, false); // re-apply width constraints of the new window
        }
        this.resizeWindows();
        if (window.isFocused()) {
            this.onWindowFocused(window);
        }
        this.grid.desktop.onLayoutChanged();
    }
    onWindowRemoved(window, passFocus) {
        const lastWindow = this.windows.length() === 1;
        const windowToFocus = this.getAboveWindow(window) ?? this.getBelowWindow(window);
        this.windows.remove(window);
        if (window === this.focusTaker) {
            this.focusTaker = windowToFocus;
        }
        if (lastWindow) {
            console.assert(this.isEmpty());
            this.destroy(passFocus);
        }
        else {
            this.resizeWindows();
            if (windowToFocus !== null) {
                switch (passFocus) {
                    case 1 /* FocusPassing.Type.Immediate */:
                        windowToFocus.focus();
                        break;
                    case 2 /* FocusPassing.Type.OnUnfocus */:
                        this.grid.focusPasser.request(windowToFocus.client.kwinClient);
                        break;
                }
            }
        }
        this.grid.desktop.onLayoutChanged();
    }
    onWindowFocused(window) {
        this.grid.onColumnFocused(this, window);
        this.focusTaker = window;
        if (this.stacked) {
            this.arrangeZ();
        }
    }
    restoreToTiled(focusedWindow) {
        const lastFocusedWindow = this.getFocusTaker();
        if (lastFocusedWindow !== null && lastFocusedWindow !== focusedWindow) {
            lastFocusedWindow.restoreToTiled();
        }
    }
    destroy(passFocus) {
        this.grid.onColumnRemoved(this, passFocus);
    }
}
Column.minWidth = 40;
class Desktop {
    constructor(kwinDesktop, pinManager, config, getScreen, layoutConfig, focusPasser) {
        this.kwinDesktop = kwinDesktop;
        this.pinManager = pinManager;
        this.config = config;
        this.getScreen = getScreen;
        this.scrollX = 0;
        this.gestureScrollXInitial = null;
        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = true;
        this.grid = new Grid(this, layoutConfig, focusPasser);
        this.clientArea = Desktop.getClientArea(this.getScreen(), kwinDesktop);
        this.tilingArea = Desktop.getTilingArea(this.clientArea, kwinDesktop, pinManager, config);
    }
    updateArea() {
        const newClientArea = Desktop.getClientArea(this.getScreen(), this.kwinDesktop);
        if (rectEquals(newClientArea, this.clientArea) && !this.dirtyPins) {
            return;
        }
        this.clientArea = newClientArea;
        this.tilingArea = Desktop.getTilingArea(newClientArea, this.kwinDesktop, this.pinManager, this.config);
        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = false;
        this.grid.onScreenSizeChanged();
        this.autoAdjustScroll();
    }
    static getClientArea(screen, kwinDesktop) {
        return Workspace.clientArea(0 /* ClientAreaOption.PlacementArea */, screen, kwinDesktop);
    }
    static getTilingArea(clientArea, kwinDesktop, pinManager, config) {
        const availableSpace = pinManager.getAvailableSpace(kwinDesktop, clientArea);
        const top = availableSpace.top + config.marginTop;
        const bottom = availableSpace.bottom - config.marginBottom;
        const left = availableSpace.left + config.marginLeft;
        const right = availableSpace.right - config.marginRight;
        return Qt.rect(left, top, right - left, bottom - top);
    }
    scrollIntoView(range) {
        const left = range.getLeft();
        const right = range.getRight();
        const initialVisibleRange = this.getCurrentVisibleRange();
        let targetScrollX;
        if (left < initialVisibleRange.getLeft()) {
            targetScrollX = left;
        }
        else if (right > initialVisibleRange.getRight()) {
            targetScrollX = right - this.tilingArea.width;
        }
        else {
            targetScrollX = initialVisibleRange.getLeft();
        }
        this.setScroll(targetScrollX, false);
    }
    scrollCenterRange(range) {
        const scrollAmount = Range.minus(range, this.getCurrentVisibleRange());
        this.adjustScroll(scrollAmount, true);
    }
    scrollCenterVisible(focusedColumn) {
        const columnRange = new Desktop.ColumnRange(focusedColumn);
        const visibleRange = this.getCurrentVisibleRange();
        columnRange.addNeighbors(visibleRange, this.grid.config.gapsInnerHorizontal);
        this.scrollCenterRange(columnRange);
    }
    autoAdjustScroll() {
        const focusedColumn = this.grid.getLastFocusedColumn();
        if (focusedColumn === null || focusedColumn.grid !== this.grid) {
            return;
        }
        this.scrollToColumn(focusedColumn, false);
    }
    scrollToColumn(column, force) {
        if (force || this.dirtyScroll || !Range.contains(this.getCurrentVisibleRange(), column)) {
            this.config.scroller.scrollToColumn(this, column);
        }
    }
    getVisibleRange(scrollX) {
        return Range.create(scrollX, this.tilingArea.width);
    }
    getCurrentVisibleRange() {
        return this.getVisibleRange(this.scrollX);
    }
    getScrollX() {
        return this.scrollX;
    }
    clampScrollX(x) {
        return this.config.clamper.clampScrollX(this, x);
    }
    setScroll(x, force) {
        const oldScrollX = this.scrollX;
        this.scrollX = force ? x : this.clampScrollX(x);
        if (this.scrollX !== oldScrollX) {
            this.onLayoutChanged();
        }
        this.dirtyScroll = false;
    }
    adjustScroll(dx, force) {
        this.setScroll(this.scrollX + dx, force);
    }
    gestureScroll(amount) {
        if (!this.config.gestureScroll) {
            return;
        }
        if (this.gestureScrollXInitial === null) {
            this.gestureScrollXInitial = this.scrollX;
        }
        if (this.config.gestureScrollInvert) {
            amount = -amount;
        }
        this.setScroll(this.gestureScrollXInitial + this.config.gestureScrollStep * amount, false);
    }
    gestureScrollFinish(focusedWindow) {
        const scrolledRight = this.scrollX > this.gestureScrollXInitial;
        this.gestureScrollXInitial = null;
        const visibleRange = this.getCurrentVisibleRange();
        if (focusedWindow !== null && !Range.contains(visibleRange, focusedWindow.column)) {
            // the focused window is no longer visible, find a new window to focus
            const focusTargetColumn = scrolledRight ?
                this.grid.getLeftmostVisibleColumn(visibleRange) :
                this.grid.getRightmostVisibleColumn(visibleRange);
            if (focusTargetColumn !== null) {
                focusTargetColumn.getWindowToFocus().focus();
            }
        }
    }
    arrange() {
        // TODO (optimization): only arrange visible windows
        this.updateArea();
        if (!this.dirty) {
            return;
        }
        this.grid.arrange(this.tilingArea.x - this.scrollX, this.getCurrentVisibleRange());
        this.dirty = false;
    }
    forceArrange() {
        this.dirty = true;
    }
    onLayoutChanged() {
        this.dirty = true;
        this.dirtyScroll = true;
    }
    onPinsChanged() {
        this.dirty = true;
        this.dirtyScroll = true;
        this.dirtyPins = true;
    }
    destroy() {
        this.grid.destroy();
    }
}
(function (Desktop) {
    class ColumnRange {
        constructor(initialColumn) {
            this.left = initialColumn;
            this.right = initialColumn;
            this.width = initialColumn.getWidth();
        }
        addNeighbors(visibleRange, gap) {
            const grid = this.left.grid;
            const columnRange = this;
            function canFit(column) {
                return columnRange.width + gap + column.getWidth() <= visibleRange.getWidth();
            }
            function isUsable(column) {
                return column !== null && canFit(column);
            }
            let leftColumn = grid.getLeftColumn(this.left);
            let rightColumn = grid.getRightColumn(this.right);
            function checkColumns() {
                if (!isUsable(leftColumn)) {
                    leftColumn = null;
                }
                if (!isUsable(rightColumn)) {
                    rightColumn = null;
                }
            }
            checkColumns();
            const visibleCenter = visibleRange.getLeft() + visibleRange.getWidth() / 2;
            while (leftColumn !== null || rightColumn !== null) {
                const leftToCenter = leftColumn === null ? Infinity : Math.abs(leftColumn.getLeft() - visibleCenter);
                const rightToCenter = rightColumn === null ? Infinity : Math.abs(rightColumn.getRight() - visibleCenter);
                if (leftToCenter < rightToCenter) {
                    this.addLeft(leftColumn, gap);
                    leftColumn = grid.getLeftColumn(leftColumn);
                }
                else {
                    this.addRight(rightColumn, gap);
                    rightColumn = grid.getRightColumn(rightColumn);
                }
                checkColumns();
            }
        }
        addLeft(column, gap) {
            this.left = column;
            this.width += column.getWidth() + gap;
        }
        addRight(column, gap) {
            this.right = column;
            this.width += column.getWidth() + gap;
        }
        getLeft() {
            return this.left.getLeft();
        }
        getRight() {
            return this.right.getRight();
        }
        getWidth() {
            return this.width;
        }
    }
    Desktop.ColumnRange = ColumnRange;
})(Desktop || (Desktop = {}));
class Grid {
    constructor(desktop, config, focusPasser) {
        this.desktop = desktop;
        this.config = config;
        this.focusPasser = focusPasser;
        this.columns = new LinkedList();
        this.lastFocusedColumn = null;
        this.width = 0;
        this.userResize = false;
        this.userResizeFinishedDelayer = new Delayer(50, () => {
            // this delay prevents windows' contents from freezing after resizing
            this.desktop.onLayoutChanged();
            this.desktop.autoAdjustScroll();
            this.desktop.arrange();
        });
    }
    moveColumn(column, leftColumn) {
        if (column === leftColumn) {
            return;
        }
        const movedLeft = leftColumn === null ? true : column.isToTheRightOf(leftColumn);
        const firstMovedColumn = movedLeft ? column : this.getRightColumn(column);
        this.columns.move(column, leftColumn);
        this.columnsSetX(firstMovedColumn);
        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }
    moveColumnLeft(column) {
        this.columns.moveBack(column);
        this.columnsSetX(column);
        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }
    moveColumnRight(column) {
        const rightColumn = this.columns.getNext(column);
        if (rightColumn === null) {
            return;
        }
        this.moveColumnLeft(rightColumn);
    }
    getWidth() {
        return this.width;
    }
    isUserResizing() {
        return this.userResize;
    }
    getLeftColumn(column) {
        return this.columns.getPrev(column);
    }
    getRightColumn(column) {
        return this.columns.getNext(column);
    }
    getFirstColumn() {
        return this.columns.getFirst();
    }
    getLastColumn() {
        return this.columns.getLast();
    }
    getColumnAtIndex(i) {
        return this.columns.getItemAtIndex(i);
    }
    getLastFocusedColumn() {
        if (this.lastFocusedColumn === null || this.lastFocusedColumn.grid !== this) {
            return null;
        }
        return this.lastFocusedColumn;
    }
    getLastFocusedWindow() {
        const lastFocusedColumn = this.getLastFocusedColumn();
        if (lastFocusedColumn === null) {
            return null;
        }
        return lastFocusedColumn.getFocusTaker();
    }
    columnsSetX(firstMovedColumn) {
        const lastUnmovedColumn = firstMovedColumn === null ? this.columns.getLast() : this.columns.getPrev(firstMovedColumn);
        let x = lastUnmovedColumn === null ? 0 : lastUnmovedColumn.getRight() + this.config.gapsInnerHorizontal;
        if (firstMovedColumn !== null) {
            for (const column of this.columns.iteratorFrom(firstMovedColumn)) {
                column.gridX = x;
                x += column.getWidth() + this.config.gapsInnerHorizontal;
            }
        }
        this.width = x - this.config.gapsInnerHorizontal;
    }
    getLeftmostVisibleColumn(visibleRange) {
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                return column;
            }
        }
        return null;
    }
    getRightmostVisibleColumn(visibleRange) {
        let last = null;
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                last = column;
            }
            else if (last !== null) {
                break;
            }
        }
        return last;
    }
    *getVisibleColumns(visibleRange) {
        for (const column of this.columns.iterator()) {
            if (Range.contains(visibleRange, column)) {
                yield column;
            }
        }
    }
    arrange(x, visibleRange) {
        for (const column of this.columns.iterator()) {
            column.arrange(x, visibleRange, this.userResize);
            x += column.getWidth() + this.config.gapsInnerHorizontal;
        }
        const focusedWindow = this.getLastFocusedWindow();
        if (focusedWindow !== null) {
            focusedWindow.client.ensureTransientsVisible(this.desktop.clientArea);
        }
    }
    onColumnAdded(column, leftColumn) {
        if (leftColumn === null) {
            this.columns.insertStart(column);
        }
        else {
            this.columns.insertAfter(column, leftColumn);
        }
        this.columnsSetX(column);
        this.desktop.onLayoutChanged();
        this.desktop.autoAdjustScroll();
    }
    onColumnRemoved(column, passFocus) {
        const isLastColumn = this.columns.length() === 1;
        const rightColumn = this.getRightColumn(column);
        const columnToFocus = isLastColumn ? null : this.getLeftColumn(column) ?? rightColumn;
        if (column === this.lastFocusedColumn) {
            this.lastFocusedColumn = columnToFocus;
        }
        this.columns.remove(column);
        this.columnsSetX(rightColumn);
        this.desktop.onLayoutChanged();
        if (columnToFocus !== null) {
            switch (passFocus) {
                case 1 /* FocusPassing.Type.Immediate */:
                    columnToFocus.getWindowToFocus().focus();
                    return;
                case 2 /* FocusPassing.Type.OnUnfocus */:
                    this.focusPasser.request(columnToFocus.getWindowToFocus().client.kwinClient);
                    return;
            }
        }
        this.desktop.autoAdjustScroll();
    }
    onColumnWidthChanged(column) {
        const rightColumn = this.columns.getNext(column);
        this.columnsSetX(rightColumn);
        this.desktop.onLayoutChanged();
        if (!this.userResize) {
            this.desktop.autoAdjustScroll();
        }
    }
    onColumnFocused(column, window) {
        const lastFocusedColumn = this.getLastFocusedColumn();
        if (lastFocusedColumn !== null) {
            lastFocusedColumn.restoreToTiled(window);
        }
        this.lastFocusedColumn = column;
        this.desktop.scrollToColumn(column, false);
    }
    onScreenSizeChanged() {
        for (const column of this.columns.iterator()) {
            column.updateWidth();
            column.resizeWindows();
        }
    }
    onUserResizeStarted() {
        this.userResize = true;
    }
    onUserResizeFinished() {
        this.userResize = false;
        this.userResizeFinishedDelayer.run();
    }
    evacuateTail(targetGrid, startColumn) {
        for (const column of this.columns.iteratorFrom(startColumn)) {
            column.moveToGrid(targetGrid, targetGrid.getLastColumn());
        }
    }
    evacuate(targetGrid) {
        for (const column of this.columns.iterator()) {
            column.moveToGrid(targetGrid, targetGrid.getLastColumn());
        }
    }
    destroy() {
        this.userResizeFinishedDelayer.destroy();
    }
}
var Range;
(function (Range) {
    function create(x, width) {
        return new Basic(x, width);
    }
    Range.create = create;
    function fromRanges(leftRange, rightRange) {
        const left = leftRange.getLeft();
        const right = rightRange.getRight();
        return new Basic(left, right - left);
    }
    Range.fromRanges = fromRanges;
    function contains(parent, child) {
        return child.getLeft() >= parent.getLeft() &&
            child.getRight() <= parent.getRight();
    }
    Range.contains = contains;
    function minus(a, b) {
        const aCenter = a.getLeft() + a.getWidth() / 2;
        const bCenter = b.getLeft() + b.getWidth() / 2;
        return Math.round(aCenter - bCenter);
    }
    Range.minus = minus;
    class Basic {
        constructor(x, width) {
            this.x = x;
            this.width = width;
        }
        getLeft() {
            return this.x;
        }
        getRight() {
            return this.x + this.width;
        }
        getWidth() {
            return this.width;
        }
    }
})(Range || (Range = {}));
class Window {
    constructor(client, column) {
        this.client = client;
        this.height = client.kwinClient.frameGeometry.height.round();
        let maximizedMode = this.client.getMaximizedMode();
        if (maximizedMode === undefined) {
            maximizedMode = 0 /* MaximizedMode.Unmaximized */; // defaulting to unmaximized, as this is set in Tiled.prepareClientForTiling
        }
        this.focusedState = {
            fullScreen: this.client.kwinClient.fullScreen,
            maximizedMode: maximizedMode,
        };
        this.skipArrange = this.client.kwinClient.fullScreen || maximizedMode !== 0 /* MaximizedMode.Unmaximized */;
        this.column = column;
        column.onWindowAdded(this, true);
    }
    moveToColumn(targetColumn, bottom, passFocus) {
        if (targetColumn === this.column) {
            return;
        }
        this.column.onWindowRemoved(this, passFocus);
        this.column = targetColumn;
        targetColumn.onWindowAdded(this, bottom);
    }
    arrange(x, y, width, height) {
        if (this.skipArrange) {
            // window is maximized, fullscreen, or being manually resized, prevent fighting with the user
            return;
        }
        let maximized = false;
        if (this.column.grid.config.reMaximize && this.isFocused()) {
            // do this here rather than in `onFocused` to ensure it happens after placement
            // (otherwise placement may not happen at all)
            if (this.focusedState.maximizedMode !== 0 /* MaximizedMode.Unmaximized */) {
                this.client.setMaximize(this.focusedState.maximizedMode === 2 /* MaximizedMode.Horizontally */ || this.focusedState.maximizedMode === 3 /* MaximizedMode.Maximized */, this.focusedState.maximizedMode === 1 /* MaximizedMode.Vertically */ || this.focusedState.maximizedMode === 3 /* MaximizedMode.Maximized */);
                maximized = true;
            }
            if (this.focusedState.fullScreen) {
                this.client.setFullScreen(true);
                maximized = true;
            }
        }
        if (!maximized) {
            this.client.place(x, y, width, height);
        }
    }
    focus() {
        this.client.focus();
        const kwinClient = this.client.kwinClient;
        if (!this.isFocused()) {
            // in some situations focus assignment just doesn't work, let's do it later
            this.column.grid.focusPasser.request(kwinClient);
        }
    }
    isFocused() {
        return this.client.isFocused();
    }
    onFocused() {
        if (this.column.grid.config.reMaximize && (this.focusedState.maximizedMode !== 0 /* MaximizedMode.Unmaximized */ ||
            this.focusedState.fullScreen)) {
            // We need to maximize/fullscreen this window, but we can't do it here.
            // We need to do it in `arrange` to ensure it happens after placement.
            this.column.grid.desktop.forceArrange();
        }
        this.column.onWindowFocused(this);
    }
    raise() {
        this.client.raise();
    }
    restoreToTiled() {
        if (this.isFocused()) {
            return;
        }
        this.client.setFullScreen(false);
        this.client.setMaximize(false, false);
    }
    onMaximizedChanged(maximizedMode) {
        const maximized = maximizedMode !== 0 /* MaximizedMode.Unmaximized */;
        this.skipArrange = maximized;
        if (this.column.grid.config.tiledKeepBelow) {
            this.client.kwinClient.keepBelow = !maximized;
        }
        if (this.column.grid.config.maximizedKeepAbove) {
            this.client.kwinClient.keepAbove = maximized;
        }
        if (this.isFocused()) {
            this.focusedState.maximizedMode = maximizedMode;
        }
        this.column.grid.desktop.onLayoutChanged();
    }
    onFullScreenChanged(fullScreen) {
        this.skipArrange = fullScreen;
        if (this.column.grid.config.tiledKeepBelow) {
            this.client.kwinClient.keepBelow = !fullScreen;
        }
        if (this.column.grid.config.maximizedKeepAbove) {
            this.client.kwinClient.keepAbove = fullScreen;
        }
        if (this.isFocused()) {
            this.focusedState.fullScreen = fullScreen;
        }
        this.column.grid.desktop.onLayoutChanged();
    }
    onFrameGeometryChanged() {
        const newGeometry = this.client.kwinClient.frameGeometry;
        this.column.setWidth(newGeometry.width.round(), true);
        this.column.grid.desktop.onLayoutChanged();
    }
    destroy(passFocus) {
        this.column.onWindowRemoved(this, passFocus);
    }
}
class ClientMatcher {
    constructor(regex) {
        this.regex = regex;
    }
    matches(kwinClient) {
        return this.regex.test(ClientMatcher.getClientString(kwinClient));
    }
    static getClientString(kwinClient) {
        return ClientMatcher.getRuleString(kwinClient.resourceClass, kwinClient.caption);
    }
    static getRuleString(ruleClass, ruleCaption) {
        return ruleClass + "\0" + ruleCaption;
    }
}
class DesktopFilter {
    constructor(desktopsConfig) {
        this.desktopRegex = DesktopFilter.parseDesktopConfig(desktopsConfig);
    }
    shouldWorkOnDesktop(kwinDesktop) {
        if (this.desktopRegex === null) {
            return true; // Work on all desktops
        }
        return this.desktopRegex.test(kwinDesktop.name);
    }
    static parseDesktopConfig(config) {
        const trimmed = config.trim();
        if (trimmed.length === 0) {
            return null; // Empty config means work on all desktops
        }
        try {
            return new RegExp(`^${trimmed}$`);
        }
        catch (e) {
            notificationInvalidTiledDesktops.sendEvent();
            log(`Invalid regex pattern in tiledDesktops config: ${trimmed}. Working on all desktops.`);
            return null; // Invalid regex means work on all desktops as fallback
        }
    }
}
class WindowRuleEnforcer {
    constructor(windowRules) {
        const [floatRegex, tileRegex, followCaptionRegex] = WindowRuleEnforcer.createWindowRuleRegexes(windowRules);
        this.preferFloating = new ClientMatcher(floatRegex);
        this.preferTiling = new ClientMatcher(tileRegex);
        this.followCaption = followCaptionRegex;
    }
    shouldTile(kwinClient) {
        return this.preferTiling.matches(kwinClient) || (kwinClient.normalWindow &&
            !kwinClient.transient &&
            !kwinClient.modal &&
            kwinClient.managed &&
            kwinClient.pid > -1 &&
            !kwinClient.fullScreen &&
            !Clients.isFullScreenGeometry(kwinClient) &&
            !this.preferFloating.matches(kwinClient));
    }
    initClientSignalManager(world, kwinClient) {
        if (!this.followCaption.test(kwinClient.resourceClass)) {
            return null;
        }
        const enforcer = this;
        const manager = new SignalManager();
        manager.connect(kwinClient.captionChanged, () => {
            const shouldTile = Clients.canTileNow(kwinClient) && enforcer.shouldTile(kwinClient);
            world.do((clientManager, desktopManager) => {
                const desktop = desktopManager.getDesktopForClient(kwinClient);
                if (shouldTile && desktop !== undefined) {
                    clientManager.tileKwinClient(kwinClient, desktop.grid);
                }
                else {
                    clientManager.floatKwinClient(kwinClient);
                }
            });
        });
        return manager;
    }
    static createWindowRuleRegexes(windowRules) {
        const floatRegexes = [];
        const tileRegexes = [];
        const followCaptionRegexes = [];
        for (const windowRule of windowRules) {
            const ruleClass = WindowRuleEnforcer.parseRegex(windowRule.class);
            const ruleCaption = WindowRuleEnforcer.parseRegex(windowRule.caption);
            const ruleString = ClientMatcher.getRuleString(WindowRuleEnforcer.wrapParens(ruleClass), WindowRuleEnforcer.wrapParens(ruleCaption));
            (windowRule.tile ? tileRegexes : floatRegexes).push(ruleString);
            if (ruleCaption !== ".*") {
                followCaptionRegexes.push(ruleClass);
            }
        }
        return [
            WindowRuleEnforcer.joinRegexes(floatRegexes),
            WindowRuleEnforcer.joinRegexes(tileRegexes),
            WindowRuleEnforcer.joinRegexes(followCaptionRegexes),
        ];
    }
    static parseRegex(rawRule) {
        if (rawRule === undefined || rawRule === "" || rawRule === ".*") {
            return ".*";
        }
        else {
            return rawRule;
        }
    }
    static joinRegexes(regexes) {
        if (regexes.length === 0) {
            return new RegExp("a^"); // match nothing
        }
        if (regexes.length === 1) {
            return new RegExp("^(" + regexes[0] + ")$");
        }
        const joinedRegexes = regexes.map(WindowRuleEnforcer.wrapParens).join("|");
        return new RegExp("^(" + joinedRegexes + ")$");
    }
    static wrapParens(str) {
        return "(" + str + ")";
    }
}
class Animator {
    constructor(duration = 150, easingCurve = "OutCubic") {
        this.currentValue = 0;
        this.callback = null;
        this.animation = Qt.createQmlObject(`import QtQuick 6.0
            Item {
                property real value: 0;
                NumberAnimation on value {
                    id: anim;
                    duration: ${duration};
                    easing.type: Easing.${easingCurve};
                }
            }`, qmlBase);
        this.animation.valueChanged.connect(() => {
            this.currentValue = this.animation.value;
            if (this.callback !== null) {
                this.callback(this.currentValue);
            }
        });
    }
    animate(from, to, callback) {
        const animObj = this.animation;
        animObj.value = from;
        this.callback = callback;
        animObj.value = to;
    }
    stop() {
        const animObj = this.animation;
        animObj.value = animObj.value; // Stop at current value
        this.callback = null;
    }
    destroy() {
        this.animation.destroy();
    }
}
class Delayer {
    constructor(delay, f) {
        this.timer = initQmlTimer();
        this.timer.interval = delay;
        this.timer.triggered.connect(f);
    }
    run() {
        this.timer.restart();
    }
    destroy() {
        this.timer.destroy();
    }
}
function initQmlTimer() {
    return Qt.createQmlObject(`import QtQuick 6.0
        Timer {}`, qmlBase);
}
class Doer {
    constructor() {
        this.nCalls = 0;
    }
    do(f) {
        this.nCalls++;
        f();
        this.nCalls--;
    }
    isDoing() {
        return this.nCalls > 0;
    }
}
class GlowingRing {
    constructor() {
        this.visible = false;
        const cfg = Config;
        if (cfg.enableGlowingRing) {
            this.ringElement = Qt.createQmlObject(`import QtQuick 6.0
                import org.kde.kwin 3.0
                
                Rectangle {
                    id: glowRing
                    property int ringWidth: ${cfg.glowingRingWidth};
                    color: "transparent"
                    border.color: "${cfg.glowingRingColor}"
                    border.width: ringWidth
                    radius: 4
                    z: 9999
                    opacity: 0.8
                    visible: false
                    
                    // Glow effect using ShaderEffect
                    layer.enabled: true
                    layer.effect: ShaderEffect {
                        property var source: glowRing
                        property real glowStrength: 0.5
                        fragmentShader: \`
                            #version 440
                            layout(location = 0) in vec2 qt_TexCoord0;
                            layout(location = 1) out vec4 fragColor;
                            layout(std140, binding = 0) uniform qt_Matrix { mat4 qt_Matrix; };\n                            uniform sampler2D source;
                            uniform float glowStrength;
                            
                            void main() {
                                vec4 pixel = texture(source, qt_TexCoord0.st);
                                if (pixel.a > 0.0) {
                                    fragColor = vec4(pixel.rgb * glowStrength, pixel.a);
                                } else {
                                    discard;
                                }
                            }
                        \`
                    }
                    
                    Behavior on opacity {
                        NumberAnimation {
                            duration: 200;
                            easing.type: Easing.OutCubic;
                        }
                    }
                }`, qmlBase);
        }
        else {
            this.ringElement = null;
        }
    }
    show(x, y, width, height) {
        const cfg = Config;
        if (!this.ringElement || !cfg.enableGlowingRing)
            return;
        const ring = this.ringElement;
        ring.x = x - cfg.glowingRingWidth;
        ring.y = y - cfg.glowingRingWidth;
        ring.width = width + (cfg.glowingRingWidth * 2);
        ring.height = height + (cfg.glowingRingWidth * 2);
        ring.visible = true;
        ring.opacity = 0.8;
        this.visible = true;
    }
    hide() {
        if (!this.ringElement || !this.visible)
            return;
        const ring = this.ringElement;
        ring.opacity = 0;
        // Hide after fade out
        this.visible = false;
    }
    updatePosition(x, y, width, height) {
        const cfg = Config;
        if (!this.ringElement || !this.visible)
            return;
        const ring = this.ringElement;
        ring.x = x - cfg.glowingRingWidth;
        ring.y = y - cfg.glowingRingWidth;
        ring.width = width + (cfg.glowingRingWidth * 2);
        ring.height = height + (cfg.glowingRingWidth * 2);
    }
    destroy() {
        if (this.ringElement) {
            this.ringElement.destroy();
        }
    }
}
class LinkedList {
    constructor() {
        this.firstNode = null;
        this.lastNode = null;
        this.itemMap = new Map();
    }
    getNode(item) {
        const node = this.itemMap.get(item);
        if (node === undefined) {
            throw new Error("item not in list");
        }
        return node;
    }
    insertBefore(item, nextItem) {
        const nextNode = this.getNode(nextItem);
        this.insert(item, nextNode.prev, nextNode);
    }
    insertAfter(item, prevItem) {
        const prevNode = this.getNode(prevItem);
        this.insert(item, prevNode, prevNode.next);
    }
    insertStart(item) {
        this.insert(item, null, this.firstNode);
    }
    insertEnd(item) {
        this.insert(item, this.lastNode, null);
    }
    insert(item, prevNode, nextNode) {
        const node = new LinkedList.Node(item);
        this.itemMap.set(item, node);
        this.insertNode(node, prevNode, nextNode);
    }
    insertNode(node, prevNode, nextNode) {
        node.prev = prevNode;
        node.next = nextNode;
        if (nextNode !== null) {
            console.assert(nextNode.prev === prevNode);
            nextNode.prev = node;
        }
        if (prevNode !== null) {
            console.assert(prevNode.next === nextNode);
            prevNode.next = node;
        }
        if (this.firstNode === nextNode) {
            this.firstNode = node;
        }
        if (this.lastNode === prevNode) {
            this.lastNode = node;
        }
    }
    getPrev(item) {
        const prevNode = this.getNode(item).prev;
        return prevNode === null ? null : prevNode.item;
    }
    getNext(item) {
        const nextNode = this.getNode(item).next;
        return nextNode === null ? null : nextNode.item;
    }
    getFirst() {
        if (this.firstNode === null) {
            return null;
        }
        return this.firstNode.item;
    }
    getLast() {
        if (this.lastNode === null) {
            return null;
        }
        return this.lastNode.item;
    }
    getItemAtIndex(index) {
        let node = this.firstNode;
        if (node === null) {
            return null;
        }
        for (let i = 0; i < index; i++) {
            node = node.next;
            if (node === null) {
                return null;
            }
        }
        return node.item;
    }
    remove(item) {
        const node = this.getNode(item);
        this.itemMap.delete(item);
        this.removeNode(node);
    }
    removeNode(node) {
        const prevNode = node.prev;
        const nextNode = node.next;
        if (prevNode !== null) {
            prevNode.next = nextNode;
        }
        if (nextNode !== null) {
            nextNode.prev = prevNode;
        }
        if (this.firstNode === node) {
            this.firstNode = nextNode;
        }
        if (this.lastNode === node) {
            this.lastNode = prevNode;
        }
    }
    contains(item) {
        return this.itemMap.has(item);
    }
    swap(node0, node1) {
        console.assert(node0.next === node1 && node1.prev === node0);
        const prevNode = node0.prev;
        const nextNode = node1.next;
        if (prevNode !== null) {
            prevNode.next = node1;
        }
        node1.next = node0;
        node0.next = nextNode;
        if (nextNode !== null) {
            nextNode.prev = node0;
        }
        node0.prev = node1;
        node1.prev = prevNode;
        if (this.firstNode === node0) {
            this.firstNode = node1;
        }
        if (this.lastNode === node1) {
            this.lastNode = node0;
        }
    }
    move(item, prevItem) {
        const node = this.getNode(item);
        this.removeNode(node);
        if (prevItem === null) {
            this.insertNode(node, null, this.firstNode);
        }
        else {
            const prevNode = this.getNode(prevItem);
            this.insertNode(node, prevNode, prevNode.next);
        }
    }
    moveBack(item) {
        const node = this.getNode(item);
        if (node.prev !== null) {
            console.assert(node !== this.firstNode);
            this.swap(node.prev, node);
        }
    }
    moveForward(item) {
        const node = this.getNode(item);
        if (node.next !== null) {
            console.assert(node !== this.lastNode);
            this.swap(node, node.next);
        }
    }
    length() {
        return this.itemMap.size;
    }
    *iterator() {
        for (let node = this.firstNode; node !== null; node = node.next) {
            yield node.item;
        }
    }
    *iteratorReverse() {
        for (let node = this.lastNode; node !== null; node = node.prev) {
            yield node.item;
        }
    }
    *iteratorFrom(startItem) {
        for (let node = this.getNode(startItem); node !== null; node = node.next) {
            yield node.item;
        }
    }
}
(function (LinkedList) {
    // TODO (optimization): reuse nodes
    class Node {
        constructor(item) {
            this.item = item;
            this.prev = null;
            this.next = null;
        }
    }
    LinkedList.Node = Node;
})(LinkedList || (LinkedList = {}));
class RateLimiter {
    constructor(n, intervalMs) {
        this.n = n;
        this.intervalMs = intervalMs;
        this.i = 0;
        this.intervalStart = 0;
    }
    acquire() {
        const now = Date.now();
        if (now - this.intervalStart >= this.intervalMs) {
            this.i = 0;
            this.intervalStart = now;
        }
        if (this.i < this.n) {
            this.i++;
            return true;
        }
        else {
            return false;
        }
    }
}
class ShortcutAction {
    constructor(keyBinding, f) {
        this.shortcutHandler = ShortcutAction.initShortcutHandler(keyBinding);
        this.shortcutHandler.activated.connect(f);
    }
    destroy() {
        this.shortcutHandler.destroy();
    }
    static initShortcutHandler(keyBinding) {
        const sequenceLine = keyBinding.defaultKeySequence !== undefined ?
            `    sequence: "${keyBinding.defaultKeySequence}";
` :
            "";
        return Qt.createQmlObject(`import QtQuick 6.0
import org.kde.kwin 3.0
ShortcutHandler {
    name: "karousel-${keyBinding.name}";
    text: "Karousel: ${keyBinding.description}";
${sequenceLine}}`, qmlBase);
    }
}
class SignalManager {
    constructor() {
        this.connections = [];
    }
    connect(signal, handler) {
        signal.connect(handler);
        this.connections.push({ signal: signal, handler: handler });
    }
    destroy() {
        for (const connection of this.connections) {
            connection.signal.disconnect(connection.handler);
        }
        this.connections = [];
    }
}
function union(array0, array1) {
    const set = new Set([...array0, ...array1]);
    return [...set];
}
function uniq(sortedArray) {
    const filtered = [];
    let lastItem;
    for (const item of sortedArray) {
        if (item !== lastItem) {
            filtered.push(item);
            lastItem = item;
        }
    }
    return filtered;
}
function mapGetOrInit(map, key, defaultItem) {
    const item = map.get(key);
    if (item !== undefined) {
        return item;
    }
    else {
        map.set(key, defaultItem);
        return defaultItem;
    }
}
function findMinPositive(items, evaluate) {
    let bestScore = Infinity;
    let bestItem = undefined;
    for (const item of items) {
        const score = evaluate(item);
        if (score > 0 && score < bestScore) {
            bestScore = score;
            bestItem = item;
        }
    }
    return bestItem;
}
function fillSpace(availableSpace, items) {
    if (items.length === 0) {
        return [];
    }
    const middleSize = findMiddleSize(availableSpace, items);
    const sizes = items.map(item => clamp(middleSize, item.min, item.max));
    if (middleSize !== Math.floor(availableSpace / items.length)) {
        distributeRemainder(availableSpace, middleSize, sizes, items);
    }
    return sizes;
    function findMiddleSize(availableSpace, items) {
        const ranges = buildRanges(items);
        let requiredSpace = items.reduce((acc, item) => acc + item.min, 0);
        for (const range of ranges) {
            const rangeSize = range.end - range.start;
            const maxRequiredSpaceDelta = rangeSize * range.n;
            if (requiredSpace + maxRequiredSpaceDelta >= availableSpace) {
                const positionInRange = (availableSpace - requiredSpace) / maxRequiredSpaceDelta;
                return Math.floor(range.start + rangeSize * positionInRange);
            }
            requiredSpace += maxRequiredSpaceDelta;
        }
        return ranges[ranges.length - 1].end;
    }
    function buildRanges(items) {
        const fenceposts = extractFenceposts(items);
        if (fenceposts.length === 1) {
            return [{
                    start: fenceposts[0].value,
                    end: fenceposts[0].value,
                    n: items.length,
                }];
        }
        const ranges = [];
        let n = 0;
        for (let i = 1; i < fenceposts.length; i++) {
            const startFencepost = fenceposts[i - 1];
            const endFencepost = fenceposts[i];
            n = n - startFencepost.nMax + startFencepost.nMin;
            ranges.push({
                start: startFencepost.value,
                end: endFencepost.value,
                n: n,
            });
        }
        return ranges;
    }
    function extractFenceposts(items) {
        const fenceposts = new Map();
        for (const item of items) {
            mapGetOrInit(fenceposts, item.min, { value: item.min, nMin: 0, nMax: 0 }).nMin++;
            mapGetOrInit(fenceposts, item.max, { value: item.max, nMin: 0, nMax: 0 }).nMax++;
        }
        const array = Array.from(fenceposts.values());
        array.sort((a, b) => a.value - b.value);
        return array;
    }
    function distributeRemainder(availableSpace, middleSize, sizes, constraints) {
        const indexes = Array.from(sizes.keys())
            .filter(i => sizes[i] === middleSize);
        indexes.sort((a, b) => constraints[a].max - constraints[b].max);
        const requiredSpace = sum(...sizes);
        let remainder = availableSpace - requiredSpace;
        let n = indexes.length;
        for (const i of indexes) {
            if (remainder <= 0) {
                break;
            }
            const enlargable = constraints[i].max - sizes[i];
            if (enlargable > 0) {
                const enlarge = Math.min(enlargable, Math.ceil(remainder / n));
                sizes[i] += enlarge;
                remainder -= enlarge;
            }
            n--;
        }
    }
}
Number.prototype.round = function () {
    return Math.round(this);
};
Number.prototype.floor = function () {
    return Math.floor(this);
};
Number.prototype.ceil = function () {
    return Math.ceil(this);
};
Function.prototype.partial = function (...head) {
    return (...tail) => this(...head, ...tail);
};
function log(...args) {
    console.log("Karousel:", ...args);
}
function clamp(value, min, max) {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
function sum(...list) {
    return list.reduce((acc, val) => acc + val);
}
function rectEquals(a, b) {
    return a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height;
}
function pointEquals(a, b) {
    return a.x === b.x &&
        a.y === b.y;
}
function rectRight(rect) {
    return rect.x + rect.width;
}
function rectBottom(rect) {
    return rect.y + rect.height;
}
function rectContainsPoint(rect, point) {
    return rect.x <= point.x &&
        rectRight(rect) >= point.x &&
        rect.y <= point.y &&
        rectBottom(rect) >= point.y;
}
function roundQtRect(rect) {
    return Qt.rect(rect.x.round(), rect.y.round(), rect.width.round(), rect.height.round());
}
function rectRightRound(rect) {
    return rect.x.round() + rect.width.round();
}
function rectBottomRound(rect) {
    return rect.y.round() + rect.height.round();
}
function applyMacro(base, value) {
    return base.replace("{}", String(value));
}
class ClientManager {
    constructor(config, world, desktopManager, pinManager) {
        this.world = world;
        this.desktopManager = desktopManager;
        this.pinManager = pinManager;
        this.world = world;
        this.config = config;
        this.desktopManager = desktopManager;
        this.pinManager = pinManager;
        this.clientMap = new Map();
        this.lastFocusedClient = null;
        let parsedWindowRules = [];
        try {
            parsedWindowRules = JSON.parse(config.windowRules);
        }
        catch (error) {
            notificationInvalidWindowRules.sendEvent();
            log("failed to parse windowRules:", error);
        }
        this.windowRuleEnforcer = new WindowRuleEnforcer(parsedWindowRules);
    }
    addClient(kwinClient) {
        console.assert(!this.hasClient(kwinClient));
        let constructState;
        let desktop;
        if (kwinClient.dock) {
            constructState = () => new ClientState.Docked(this.world, kwinClient);
        }
        else if (Clients.canTileEver(kwinClient) &&
            this.windowRuleEnforcer.shouldTile(kwinClient) &&
            (desktop = this.desktopManager.getDesktopForClient(kwinClient)) !== undefined) {
            Clients.makeTileable(kwinClient);
            console.assert(Clients.canTileNow(kwinClient));
            constructState = (client) => new ClientState.Tiled(this.world, client, desktop.grid);
        }
        else {
            constructState = (client) => new ClientState.Floating(this.world, client, this.config, false);
        }
        const client = new ClientWrapper(kwinClient, constructState, this.findTransientFor(kwinClient), this.windowRuleEnforcer.initClientSignalManager(this.world, kwinClient));
        this.clientMap.set(kwinClient, client);
    }
    removeClient(kwinClient, passFocus) {
        console.assert(this.hasClient(kwinClient));
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        if (kwinClient !== this.lastFocusedClient) {
            passFocus = 0 /* FocusPassing.Type.None */;
        }
        client.destroy(passFocus);
        this.clientMap.delete(kwinClient);
    }
    findTransientFor(kwinClient) {
        // Disable window grouping (transient handling) if configured
        if (this.config.disableWindowGrouping) {
            return null;
        }
        if (!kwinClient.transient || kwinClient.transientFor === null) {
            return null;
        }
        const transientFor = this.clientMap.get(kwinClient.transientFor);
        if (transientFor === undefined) {
            return null;
        }
        return transientFor;
    }
    minimizeClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        if (client.stateManager.getState() instanceof ClientState.Tiled) {
            const passFocus = kwinClient === this.lastFocusedClient ? 1 /* FocusPassing.Type.Immediate */ : 0 /* FocusPassing.Type.None */;
            client.stateManager.setState(() => new ClientState.TiledMinimized(this.world, client), passFocus);
        }
    }
    tileClient(client, grid) {
        if (client.stateManager.getState() instanceof ClientState.Tiled) {
            return;
        }
        client.stateManager.setState(() => new ClientState.Tiled(this.world, client, grid), 0 /* FocusPassing.Type.None */);
    }
    floatClient(client) {
        if (client.stateManager.getState() instanceof ClientState.Floating) {
            return;
        }
        client.stateManager.setState(() => new ClientState.Floating(this.world, client, this.config, true), 0 /* FocusPassing.Type.None */);
    }
    tileKwinClient(kwinClient, grid) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        this.tileClient(client, grid);
    }
    floatKwinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        this.floatClient(client);
    }
    pinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        if (client.getMaximizedMode() !== 0 /* MaximizedMode.Unmaximized */) {
            // the client is not really kwin-tiled, just maximized
            kwinClient.tile = null;
            return;
        }
        client.stateManager.setState(() => new ClientState.Pinned(this.world, this.pinManager, this.desktopManager, kwinClient, this.config), 0 /* FocusPassing.Type.None */);
        this.pinManager.addClient(kwinClient);
        for (const desktop of this.desktopManager.getDesktopsForClient(kwinClient)) {
            desktop.onPinsChanged();
        }
    }
    unpinClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        console.assert(client.stateManager.getState() instanceof ClientState.Pinned);
        client.stateManager.setState(() => new ClientState.Floating(this.world, client, this.config, false), 0 /* FocusPassing.Type.None */);
        this.pinManager.removeClient(kwinClient);
        for (const desktop of this.desktopManager.getDesktopsForClient(kwinClient)) {
            desktop.onPinsChanged();
        }
    }
    toggleFloatingClient(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return;
        }
        const clientState = client.stateManager.getState();
        if ((clientState instanceof ClientState.Floating || clientState instanceof ClientState.Pinned) && Clients.canTileEver(kwinClient)) {
            Clients.makeTileable(kwinClient);
            const desktop = this.desktopManager.getDesktopForClient(kwinClient);
            if (desktop === undefined) {
                return;
            }
            client.stateManager.setState(() => new ClientState.Tiled(this.world, client, desktop.grid), 0 /* FocusPassing.Type.None */);
        }
        else if (clientState instanceof ClientState.Tiled && !this.config.preventUntile) {
            // Only allow untile if preventUntile is disabled
            client.stateManager.setState(() => new ClientState.Floating(this.world, client, this.config, true), 0 /* FocusPassing.Type.None */);
        }
    }
    hasClient(kwinClient) {
        return this.clientMap.has(kwinClient);
    }
    onClientFocused(kwinClient) {
        this.lastFocusedClient = kwinClient;
        const window = this.findTiledWindow(kwinClient);
        if (window === null) {
            return;
        }
        window.onFocused();
        if (this.config.cursorFollowsFocus) {
            this.moveCursorToWindow(window);
        }
    }
    findTiledWindow(kwinClient) {
        const client = this.clientMap.get(kwinClient);
        if (client === undefined) {
            return null;
        }
        return this.findTiledWindowOfClient(client);
    }
    findTiledWindowOfClient(client) {
        const clientState = client.stateManager.getState();
        if (clientState instanceof ClientState.Tiled) {
            return clientState.window;
        }
        else if (client.transientFor !== null) {
            return this.findTiledWindowOfClient(client.transientFor);
        }
        else {
            return null;
        }
    }
    removeAllClients() {
        for (const kwinClient of Array.from(this.clientMap.keys())) {
            this.removeClient(kwinClient, 0 /* FocusPassing.Type.None */);
        }
    }
    destroy() {
        this.removeAllClients();
    }
    moveCursorToWindow(window) {
        const cursorAlreadyOnWindow = rectContainsPoint(roundQtRect(window.client.kwinClient.frameGeometry), Workspace.cursorPos);
        if (cursorAlreadyOnWindow) {
            return;
        }
        moveCursorToFocus.call();
    }
}
class ClientWrapper {
    constructor(kwinClient, constructInitialState, transientFor, rulesSignalManager) {
        this.kwinClient = kwinClient;
        this.transientFor = transientFor;
        this.rulesSignalManager = rulesSignalManager;
        this.animator = null;
        this.kwinClient = kwinClient;
        this.transientFor = transientFor;
        this.transients = [];
        if (transientFor !== null) {
            transientFor.addTransient(this);
        }
        this.signalManager = ClientWrapper.initSignalManager(this);
        this.rulesSignalManager = rulesSignalManager;
        this.preferredWidth = kwinClient.frameGeometry.width.round();
        this.manipulatingGeometry = new Doer();
        this.lastPlacement = null;
        this.stateManager = new ClientState.Manager(constructInitialState(this));
        // Initialize animator if animations are enabled
        if (Config.enableAnimations) {
            this.animator = Qt.createQmlObject(`import QtQuick 6.0
                Item {
                    property real xVal: 0;
                    property real yVal: 0;
                    property real wVal: 0;
                    property real hVal: 0;
                    property real opacityVal: 1;
                    
                    NumberAnimation on xVal { id: animX; duration: ${Config.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on yVal { id: animY; duration: ${Config.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on wVal { id: animW; duration: ${Config.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on hVal { id: animH; duration: ${Config.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on opacityVal { id: animOpacity; duration: ${Config.animationDuration}; easing.type: Easing.OutCubic; }
                }`, qmlBase);
        }
    }
    place(x, y, width, height, animate = false) {
        if (animate && this.animator && Config.enableAnimations) {
            const animObj = this.animator;
            const oldGeo = this.kwinClient.frameGeometry;
            // Set starting values
            animObj.xVal = oldGeo.x;
            animObj.yVal = oldGeo.y;
            animObj.wVal = oldGeo.width;
            animObj.hVal = oldGeo.height;
            // Animate to target values
            animObj.xVal = x;
            animObj.yVal = y;
            animObj.wVal = width;
            animObj.hVal = height;
            // Apply changes during animation
            const applyGeometry = () => {
                this.manipulatingGeometry.do(() => {
                    if (this.kwinClient.resize)
                        return;
                    this.kwinClient.frameGeometry.x = animObj.xVal;
                    this.kwinClient.frameGeometry.y = animObj.yVal;
                    this.kwinClient.frameGeometry.width = animObj.wVal;
                    this.kwinClient.frameGeometry.height = animObj.hVal;
                });
            };
            animObj.xValChanged.connect(applyGeometry);
            animObj.yValChanged.connect(applyGeometry);
            animObj.wValChanged.connect(applyGeometry);
            animObj.hValChanged.connect(applyGeometry);
        }
        else {
            this.manipulatingGeometry.do(() => {
                if (this.kwinClient.resize) {
                    return;
                }
                this.lastPlacement = Qt.rect(x, y, width, height);
                this.kwinClient.frameGeometry = this.lastPlacement;
                if (this.kwinClient.frameGeometry !== this.lastPlacement) {
                    this.kwinClient.frameGeometry.x = x;
                    this.kwinClient.frameGeometry = this.lastPlacement;
                }
            });
        }
    }
    moveTransient(dx, dy, kwinDesktops) {
        if (this.stateManager.getState() instanceof ClientState.Floating) {
            if (Clients.isOnOneOfVirtualDesktops(this.kwinClient, kwinDesktops)) {
                const frame = this.kwinClient.frameGeometry;
                this.kwinClient.frameGeometry = Qt.rect(frame.x.round() + dx, frame.y.round() + dy, frame.width.round(), frame.height.round());
            }
            for (const transient of this.transients) {
                transient.moveTransient(dx, dy, kwinDesktops);
            }
        }
    }
    moveTransients(dx, dy) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, this.kwinClient.desktops);
        }
    }
    focus() {
        Workspace.activeWindow = this.kwinClient;
    }
    isFocused() {
        return Workspace.activeWindow === this.kwinClient;
    }
    raise() {
        Workspace.raiseWindow(this.kwinClient);
    }
    setMaximize(horizontally, vertically) {
        if (!this.kwinClient.maximizable) {
            this.maximizedMode = 0 /* MaximizedMode.Unmaximized */;
            return;
        }
        if (this.maximizedMode === undefined) {
            if (horizontally && vertically) {
                this.maximizedMode = 3 /* MaximizedMode.Maximized */;
            }
            else if (horizontally) {
                this.maximizedMode = 2 /* MaximizedMode.Horizontally */;
            }
            else if (vertically) {
                this.maximizedMode = 1 /* MaximizedMode.Vertically */;
            }
            else {
                this.maximizedMode = 0 /* MaximizedMode.Unmaximized */;
            }
        }
        this.manipulatingGeometry.do(() => {
            this.kwinClient.setMaximize(vertically, horizontally);
        });
    }
    setFullScreen(fullScreen) {
        if (!this.kwinClient.fullScreenable) {
            return;
        }
        this.manipulatingGeometry.do(() => {
            this.kwinClient.fullScreen = fullScreen;
        });
    }
    getMaximizedMode() {
        return this.maximizedMode;
    }
    isManipulatingGeometry(newGeometry) {
        if (newGeometry !== null && newGeometry === this.lastPlacement) {
            return true;
        }
        return this.manipulatingGeometry.isDoing();
    }
    addTransient(transient) {
        this.transients.push(transient);
    }
    removeTransient(transient) {
        const i = this.transients.indexOf(transient);
        this.transients.splice(i, 1);
    }
    ensureTransientsVisible(screenSize) {
        for (const transient of this.transients) {
            if (transient.stateManager.getState() instanceof ClientState.Floating) {
                transient.ensureVisible(screenSize);
                transient.ensureTransientsVisible(screenSize);
            }
        }
    }
    ensureVisible(screenSize) {
        if (!Clients.isOnVirtualDesktop(this.kwinClient, Workspace.currentDesktop)) {
            return;
        }
        const frame = roundQtRect(this.kwinClient.frameGeometry);
        if (frame.x < screenSize.x) {
            this.place(screenSize.x, frame.y, frame.width, frame.height);
        }
        else if (rectRight(frame) > rectRight(screenSize)) {
            this.place(rectRight(screenSize) - frame.width, frame.y, frame.width, frame.height);
        }
    }
    destroy(passFocus) {
        this.stateManager.destroy(passFocus);
        this.signalManager.destroy();
        if (this.rulesSignalManager !== null) {
            this.rulesSignalManager.destroy();
        }
        if (this.transientFor !== null) {
            this.transientFor.removeTransient(this);
        }
        for (const transient of this.transients) {
            transient.transientFor = null;
        }
    }
    static initSignalManager(client) {
        const manager = new SignalManager();
        manager.connect(client.kwinClient.maximizedAboutToChange, (maximizedMode) => {
            if (maximizedMode !== 0 /* MaximizedMode.Unmaximized */ && client.kwinClient.tile !== null) {
                client.kwinClient.tile = null;
            }
            client.maximizedMode = maximizedMode;
        });
        return manager;
    }
}
var Clients;
(function (Clients) {
    const prohibitedClasses = [
        "ksmserver-logout-greeter",
        "xwaylandvideobridge",
    ];
    function canTileEver(kwinClient) {
        const shapeable = (kwinClient.moveable && kwinClient.resizeable) || kwinClient.fullScreen; // full-screen windows may become shapeable after exiting full-screen mode
        return shapeable &&
            !kwinClient.popupWindow &&
            !prohibitedClasses.includes(kwinClient.resourceClass);
    }
    Clients.canTileEver = canTileEver;
    function canTileNow(kwinClient) {
        return canTileEver(kwinClient) &&
            !kwinClient.minimized &&
            kwinClient.desktops.length === 1 &&
            kwinClient.activities.length === 1;
    }
    Clients.canTileNow = canTileNow;
    function makeTileable(kwinClient) {
        if (kwinClient.minimized) {
            kwinClient.minimized = false;
        }
        if (kwinClient.desktops.length !== 1) {
            kwinClient.desktops = [Workspace.currentDesktop];
        }
        if (kwinClient.activities.length !== 1) {
            kwinClient.activities = [Workspace.currentActivity];
        }
    }
    Clients.makeTileable = makeTileable;
    function getKwinDesktopApprox(kwinClient) {
        switch (kwinClient.desktops.length) {
            case 0:
                return Workspace.currentDesktop;
            case 1:
                return kwinClient.desktops[0];
            default:
                if (kwinClient.desktops.includes(Workspace.currentDesktop)) {
                    return Workspace.currentDesktop;
                }
                else {
                    return kwinClient.desktops[0];
                }
        }
    }
    Clients.getKwinDesktopApprox = getKwinDesktopApprox;
    function isFullScreenGeometry(kwinClient) {
        const fullScreenArea = Workspace.clientArea(4 /* ClientAreaOption.FullScreenArea */, kwinClient.output, getKwinDesktopApprox(kwinClient));
        return kwinClient.clientGeometry.width.round() >= fullScreenArea.width &&
            kwinClient.clientGeometry.height.round() >= fullScreenArea.height;
    }
    Clients.isFullScreenGeometry = isFullScreenGeometry;
    function isOnVirtualDesktop(kwinClient, kwinDesktop) {
        return kwinClient.desktops.length === 0 || kwinClient.desktops.includes(kwinDesktop);
    }
    Clients.isOnVirtualDesktop = isOnVirtualDesktop;
    function isOnOneOfVirtualDesktops(kwinClient, kwinDesktops) {
        return kwinClient.desktops.length === 0 || kwinClient.desktops.some(d => kwinDesktops.includes(d));
    }
    Clients.isOnOneOfVirtualDesktops = isOnOneOfVirtualDesktops;
})(Clients || (Clients = {}));
class DesktopManager {
    constructor(pinManager, config, layoutConfig, focusPasser, desktopFilter) {
        this.pinManager = pinManager;
        this.config = config;
        this.layoutConfig = layoutConfig;
        this.focusPasser = focusPasser;
        this.desktopFilter = desktopFilter;
        this.pinManager = pinManager;
        this.config = config;
        this.layoutConfig = layoutConfig;
        this.desktops = new Map();
        this.selectedScreen = Workspace.activeScreen;
        this.kwinActivities = new Set(Workspace.activities);
        this.kwinDesktops = new Set(Workspace.desktops);
    }
    getDesktop(activity, kwinDesktop) {
        if (!this.desktopFilter.shouldWorkOnDesktop(kwinDesktop)) {
            return undefined;
        }
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);
        if (desktop !== undefined) {
            return desktop;
        }
        else {
            return this.addDesktop(activity, kwinDesktop);
        }
    }
    getCurrentDesktop() {
        return this.getDesktop(Workspace.currentActivity, Workspace.currentDesktop);
    }
    getDesktopInCurrentActivity(kwinDesktop) {
        return this.getDesktop(Workspace.currentActivity, kwinDesktop);
    }
    getDesktopForClient(kwinClient) {
        if (kwinClient.activities.length !== 1 || kwinClient.desktops.length !== 1) {
            return undefined;
        }
        return this.getDesktop(kwinClient.activities[0], kwinClient.desktops[0]);
    }
    addDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = new Desktop(kwinDesktop, this.pinManager, this.config, () => this.selectedScreen, this.layoutConfig, this.focusPasser);
        this.desktops.set(desktopKey, desktop);
        return desktop;
    }
    static getDesktopKey(activity, kwinDesktop) {
        return activity + "|" + kwinDesktop.id;
    }
    updateActivities() {
        const newActivities = new Set(Workspace.activities);
        for (const activity of this.kwinActivities) {
            if (!newActivities.has(activity)) {
                this.removeActivity(activity);
            }
        }
        this.kwinActivities = newActivities;
    }
    updateDesktops() {
        const newDesktops = new Set(Workspace.desktops);
        for (const desktop of this.kwinDesktops) {
            if (!newDesktops.has(desktop)) {
                this.removeKwinDesktop(desktop);
            }
        }
        this.kwinDesktops = newDesktops;
    }
    selectScreen(screen) {
        this.selectedScreen = screen;
    }
    removeActivity(activity) {
        for (const kwinDesktop of this.kwinDesktops) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }
    removeKwinDesktop(kwinDesktop) {
        for (const activity of this.kwinActivities) {
            this.destroyDesktop(activity, kwinDesktop);
        }
    }
    destroyDesktop(activity, kwinDesktop) {
        const desktopKey = DesktopManager.getDesktopKey(activity, kwinDesktop);
        const desktop = this.desktops.get(desktopKey);
        if (desktop !== undefined) {
            desktop.destroy();
            this.desktops.delete(desktopKey);
        }
    }
    destroy() {
        for (const desktop of this.desktops.values()) {
            desktop.destroy();
        }
    }
    *getAllDesktops() {
        for (const desktop of this.desktops.values()) {
            yield desktop;
        }
    }
    getDesktopsForClient(kwinClient) {
        const desktops = this.getDesktops(kwinClient.activities, kwinClient.desktops); // workaround for QTBUG-109880
        return desktops;
    }
    // empty array means all
    *getDesktops(activities, kwinDesktops) {
        const matchedActivities = activities.length > 0 ? activities : this.kwinActivities.keys();
        const matchedDesktops = kwinDesktops.length > 0 ? kwinDesktops : this.kwinDesktops.keys();
        for (const matchedActivity of matchedActivities) {
            for (const matchedDesktop of matchedDesktops) {
                const desktopKey = DesktopManager.getDesktopKey(matchedActivity, matchedDesktop);
                const desktop = this.desktops.get(desktopKey);
                if (desktop !== undefined) {
                    yield desktop;
                }
            }
        }
    }
}
var FocusPassing;
(function (FocusPassing) {
    class Passer {
        constructor() {
            this.currentRequest = null;
        }
        request(target) {
            this.currentRequest = new Request(target, Date.now());
        }
        clear() {
            this.currentRequest = null;
        }
        clearIfDifferent(kwinClient) {
            if (this.currentRequest !== null && this.currentRequest.target !== kwinClient) {
                this.clear();
            }
        }
        activate() {
            if (this.currentRequest === null) {
                return;
            }
            if (this.currentRequest.isExpired()) {
                this.clear();
                return;
            }
            Workspace.activeWindow = this.currentRequest.target;
        }
    }
    FocusPassing.Passer = Passer;
    class Request {
        constructor(target, time) {
            this.target = target;
            this.time = time;
        }
        isExpired() {
            return Date.now() - this.time > Request.validMs;
        }
    }
    Request.validMs = 200;
})(FocusPassing || (FocusPassing = {}));
class PinManager {
    constructor() {
        this.pinnedClients = new Set();
    }
    addClient(kwinClient) {
        this.pinnedClients.add(kwinClient);
    }
    removeClient(kwinClient) {
        this.pinnedClients.delete(kwinClient);
    }
    getAvailableSpace(kwinDesktop, screen) {
        const baseLot = new PinManager.Lot(screen.y, rectBottom(screen), screen.x, rectRight(screen));
        let lots = [baseLot];
        for (const client of this.pinnedClients) {
            if (!Clients.isOnVirtualDesktop(client, kwinDesktop) || client.minimized) {
                continue;
            }
            const newLots = [];
            for (const lot of lots) {
                lot.split(newLots, roundQtRect(client.frameGeometry));
            }
            lots = newLots;
        }
        let largestLot = baseLot;
        let largestArea = 0;
        for (const lot of lots) {
            const area = lot.area();
            if (area > largestArea) {
                largestArea = area;
                largestLot = lot;
            }
        }
        return largestLot;
    }
}
(function (PinManager) {
    class Lot {
        constructor(top, bottom, left, right) {
            this.top = top;
            this.bottom = bottom;
            this.left = left;
            this.right = right;
        }
        split(destLots, obstacle) {
            if (!this.contains(obstacle)) {
                // don't split
                destLots.push(this);
                return;
            }
            if (obstacle.y - this.top >= Lot.minHeight) {
                destLots.push(new Lot(this.top, obstacle.y, this.left, this.right));
            }
            if (this.bottom - rectBottom(obstacle) >= Lot.minHeight) {
                destLots.push(new Lot(rectBottom(obstacle), this.bottom, this.left, this.right));
            }
            if (obstacle.x - this.left >= Lot.minWidth) {
                destLots.push(new Lot(this.top, this.bottom, this.left, obstacle.x));
            }
            if (this.right - rectRight(obstacle) >= Lot.minWidth) {
                destLots.push(new Lot(this.top, this.bottom, rectRight(obstacle), this.right));
            }
        }
        contains(obstacle) {
            return rectRight(obstacle) > this.left && obstacle.x < this.right &&
                rectBottom(obstacle) > this.top && obstacle.y < this.bottom;
        }
        area() {
            return (this.bottom - this.top) * (this.right - this.left);
        }
    }
    Lot.minWidth = 200;
    Lot.minHeight = 200;
    PinManager.Lot = Lot;
})(PinManager || (PinManager = {}));
class World {
    constructor(config) {
        const focusPasser = new FocusPassing.Passer();
        this.workspaceSignalManager = initWorkspaceSignalHandlers(this, focusPasser);
        let presetWidths = {
            next: (currentWidth, minWidth, maxWidth, tilingAreaWidth) => currentWidth,
            prev: (currentWidth, minWidth, maxWidth, tilingAreaWidth) => currentWidth,
            getWidths: (minWidth, maxWidth, tilingAreaWidth) => [],
        };
        try {
            presetWidths = new PresetWidths(config.presetWidths, config.gapsInnerHorizontal);
        }
        catch (error) {
            notificationInvalidPresetWidths.sendEvent();
            log("failed to parse presetWidths:", error);
        }
        this.shortcutActions = registerKeyBindings(this, {
            manualScrollStep: config.manualScrollStep,
            presetWidths: presetWidths,
            verticalResizeStep: config.verticalResizeStep,
            columnResizer: config.scrollingCentered ? new RawResizer(presetWidths) : new ContextualResizer(presetWidths),
        });
        this.screenResizedDelayer = new Delayer(1000, () => {
            // this delay ensures that docks are taken into account by `Workspace.clientArea`
            for (const desktop of this.desktopManager.getAllDesktops()) {
                desktop.onLayoutChanged();
            }
            this.update();
        });
        this.pinManager = new PinManager();
        const layoutConfig = {
            gapsInnerHorizontal: config.gapsInnerHorizontal,
            gapsInnerVertical: config.gapsInnerVertical,
            stackOffsetX: config.stackOffsetX,
            stackOffsetY: config.stackOffsetY,
            offScreenOpacity: config.offScreenOpacity / 100.0,
            stackColumnsByDefault: config.stackColumnsByDefault,
            resizeNeighborColumn: config.resizeNeighborColumn,
            reMaximize: config.reMaximize,
            skipSwitcher: config.skipSwitcher,
            tiledKeepBelow: config.tiledKeepBelow,
            maximizedKeepAbove: config.floatingKeepAbove,
            untileOnDrag: config.untileOnDrag,
        };
        this.desktopManager = new DesktopManager(this.pinManager, {
            marginTop: config.gapsOuterTop,
            marginBottom: config.gapsOuterBottom,
            marginLeft: config.gapsOuterLeft,
            marginRight: config.gapsOuterRight,
            scroller: World.createScroller(config),
            clamper: config.scrollingLazy ? new EdgeClamper() : new CenterClamper(),
            gestureScroll: config.gestureScroll,
            gestureScrollInvert: config.gestureScrollInvert,
            gestureScrollStep: config.gestureScrollStep,
        }, layoutConfig, focusPasser, new DesktopFilter(config.tiledDesktops));
        this.clientManager = new ClientManager(config, this, this.desktopManager, this.pinManager);
        this.addExistingClients();
        this.update();
    }
    static createScroller(config) {
        if (config.scrollingLazy) {
            return new LazyScroller();
        }
        else if (config.scrollingCentered) {
            return new CenteredScroller();
        }
        else if (config.scrollingGrouped) {
            return new GroupedScroller();
        }
        else {
            log("No scrolling mode selected, using default");
            return new LazyScroller();
        }
    }
    addExistingClients() {
        for (const kwinClient of Workspace.windows) {
            this.clientManager.addClient(kwinClient);
        }
    }
    update() {
        const currentDesktop = this.desktopManager.getCurrentDesktop();
        if (currentDesktop !== undefined) {
            currentDesktop.arrange();
        }
    }
    do(f) {
        f(this.clientManager, this.desktopManager);
        this.update();
    }
    doIfTiled(kwinClient, f) {
        const window = this.clientManager.findTiledWindow(kwinClient);
        if (window === null) {
            return;
        }
        const column = window.column;
        const grid = column.grid;
        f(this.clientManager, this.desktopManager, window, column, grid);
        this.update();
    }
    doIfTiledFocused(f) {
        if (Workspace.activeWindow === null) {
            return;
        }
        this.doIfTiled(Workspace.activeWindow, f);
    }
    gestureScroll(amount) {
        this.do((clientManager, desktopManager) => {
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                currentDesktop.gestureScroll(amount);
            }
        });
    }
    gestureScrollFinish() {
        this.do((clientManager, desktopManager) => {
            const focusedWindow = Workspace.activeWindow === null ? null : clientManager.findTiledWindow(Workspace.activeWindow);
            const currentDesktop = desktopManager.getCurrentDesktop();
            if (currentDesktop !== undefined) {
                console.assert(focusedWindow === null || focusedWindow.column.grid.desktop === currentDesktop);
                currentDesktop.gestureScrollFinish(focusedWindow);
            }
        });
    }
    destroy() {
        this.workspaceSignalManager.destroy();
        for (const shortcutAction of this.shortcutActions) {
            shortcutAction.destroy();
        }
        this.clientManager.destroy();
        this.desktopManager.destroy();
    }
    onScreenResized() {
        this.screenResizedDelayer.run();
    }
}
var ClientState;
(function (ClientState) {
    class Docked {
        constructor(world, kwinClient) {
            this.world = world;
            this.signalManager = Docked.initSignalManager(world, kwinClient);
            world.onScreenResized();
        }
        destroy(passFocus) {
            this.signalManager.destroy();
            this.world.onScreenResized();
        }
        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();
            manager.connect(kwinClient.frameGeometryChanged, () => {
                world.onScreenResized();
            });
            return manager;
        }
    }
    ClientState.Docked = Docked;
})(ClientState || (ClientState = {}));
var ClientState;
(function (ClientState) {
    class Floating {
        constructor(world, client, config, limitHeight) {
            this.client = client;
            this.config = config;
            if (config.floatingKeepAbove) {
                client.kwinClient.keepAbove = true;
            }
            if (limitHeight && client.kwinClient.tile === null) {
                Floating.limitHeight(client);
            }
            this.signalManager = Floating.initSignalManager(world, client.kwinClient);
        }
        destroy(passFocus) {
            this.signalManager.destroy();
        }
        // TODO: move to `Tiled.restoreClientAfterTiling`
        static limitHeight(client) {
            const placementArea = Workspace.clientArea(0 /* ClientAreaOption.PlacementArea */, client.kwinClient.output, Clients.getKwinDesktopApprox(client.kwinClient));
            const clientRect = client.kwinClient.frameGeometry;
            const width = client.preferredWidth;
            client.place(clientRect.x.round(), clientRect.y.round(), width, Math.min(clientRect.height.round(), Math.round(placementArea.height / 2)));
        }
        static initSignalManager(world, kwinClient) {
            const manager = new SignalManager();
            manager.connect(kwinClient.tileChanged, () => {
                // on X11, this fires after `frameGeometryChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });
            manager.connect(kwinClient.frameGeometryChanged, () => {
                // on Wayland, this fires after `tileChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });
            return manager;
        }
    }
    ClientState.Floating = Floating;
})(ClientState || (ClientState = {}));
var ClientState;
(function (ClientState) {
    class Manager {
        constructor(initialState) {
            this.state = initialState;
        }
        setState(constructNewState, passFocus) {
            this.state.destroy(passFocus);
            this.state = constructNewState();
        }
        getState() {
            return this.state;
        }
        destroy(passFocus) {
            this.state.destroy(passFocus);
        }
    }
    ClientState.Manager = Manager;
})(ClientState || (ClientState = {}));
var ClientState;
(function (ClientState) {
    class Pinned {
        constructor(world, pinManager, desktopManager, kwinClient, config) {
            this.kwinClient = kwinClient;
            this.pinManager = pinManager;
            this.desktopManager = desktopManager;
            this.config = config;
            if (config.floatingKeepAbove) {
                kwinClient.keepAbove = true;
            }
            this.signalManager = Pinned.initSignalManager(world, pinManager, kwinClient);
        }
        destroy(passFocus) {
            this.signalManager.destroy();
            this.pinManager.removeClient(this.kwinClient);
            for (const desktop of this.desktopManager.getDesktopsForClient(this.kwinClient)) {
                desktop.onPinsChanged();
            }
        }
        static initSignalManager(world, pinManager, kwinClient) {
            const manager = new SignalManager();
            let oldActivities = kwinClient.activities;
            let oldDesktops = kwinClient.desktops;
            manager.connect(kwinClient.tileChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                }
            });
            manager.connect(kwinClient.frameGeometryChanged, () => {
                if (kwinClient.tile === null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.unpinClient(kwinClient);
                    });
                    return;
                }
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });
            manager.connect(kwinClient.minimizedChanged, () => {
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktopsForClient(kwinClient)) {
                        desktop.onPinsChanged();
                    }
                });
            });
            manager.connect(kwinClient.desktopsChanged, () => {
                const changedDesktops = oldDesktops.length === 0 || kwinClient.desktops.length === 0 ?
                    [] :
                    union(oldDesktops, kwinClient.desktops);
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(kwinClient.activities, changedDesktops)) {
                        desktop.onPinsChanged();
                    }
                });
                oldDesktops = kwinClient.desktops;
            });
            manager.connect(kwinClient.activitiesChanged, () => {
                const changedActivities = oldActivities.length === 0 || kwinClient.activities.length === 0 ?
                    [] :
                    union(oldActivities, kwinClient.activities);
                world.do((clientManager, desktopManager) => {
                    for (const desktop of desktopManager.getDesktops(changedActivities, kwinClient.desktops)) {
                        desktop.onPinsChanged();
                    }
                });
                oldActivities = kwinClient.activities;
            });
            return manager;
        }
    }
    ClientState.Pinned = Pinned;
})(ClientState || (ClientState = {}));
var ClientState;
(function (ClientState) {
    class Tiled {
        constructor(world, client, grid) {
            this.defaultState = { skipSwitcher: client.kwinClient.skipSwitcher };
            Tiled.prepareClientForTiling(client, grid.config);
            const column = new Column(grid, grid.getLastFocusedColumn() ?? grid.getLastColumn());
            const window = new Window(client, column);
            this.window = window;
            this.signalManager = Tiled.initSignalManager(world, window, grid.config);
        }
        destroy(passFocus) {
            this.signalManager.destroy();
            const window = this.window;
            const grid = window.column.grid;
            const client = window.client;
            window.destroy(passFocus);
            Tiled.restoreClientAfterTiling(client, grid.config, this.defaultState, grid.desktop.clientArea);
        }
        static initSignalManager(world, window, config) {
            const client = window.client;
            const kwinClient = client.kwinClient;
            const manager = new SignalManager();
            manager.connect(kwinClient.desktopsChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // windows on multiple desktops are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });
            manager.connect(kwinClient.activitiesChanged, () => {
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(kwinClient);
                    if (desktop === undefined) {
                        // windows on multiple activities are not supported
                        clientManager.floatClient(client);
                        return;
                    }
                    Tiled.moveWindowToGrid(window, desktop.grid);
                });
            });
            manager.connect(kwinClient.minimizedChanged, () => {
                console.assert(kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    clientManager.minimizeClient(kwinClient);
                });
            });
            manager.connect(kwinClient.maximizedAboutToChange, (maximizedMode) => {
                world.do(() => {
                    window.onMaximizedChanged(maximizedMode);
                });
            });
            let moving = false;
            let resizing = false;
            let resizeStartWidth = 0;
            let resizeNeighbor;
            manager.connect(kwinClient.interactiveMoveResizeStarted, () => {
                if (kwinClient.move) {
                    if (config.untileOnDrag) {
                        world.do((clientManager, desktopManager) => {
                            clientManager.floatClient(client);
                        });
                    }
                    else {
                        moving = true;
                    }
                    return;
                }
                if (kwinClient.resize) {
                    resizing = true;
                    resizeStartWidth = window.column.getWidth();
                    if (config.resizeNeighborColumn) {
                        const resizeNeighborColumn = Tiled.getResizeNeighborColumn(window);
                        if (resizeNeighborColumn !== null) {
                            resizeNeighbor = {
                                column: resizeNeighborColumn,
                                startWidth: resizeNeighborColumn.getWidth(),
                            };
                        }
                    }
                    window.column.grid.onUserResizeStarted();
                }
            });
            manager.connect(kwinClient.interactiveMoveResizeFinished, () => {
                if (moving) {
                    moving = false;
                    world.do(() => window.column.grid.desktop.onLayoutChanged()); // move the dragged window back to its position
                }
                if (resizing) {
                    resizing = false;
                    resizeNeighbor = undefined;
                    window.column.grid.onUserResizeFinished();
                }
            });
            const externalFrameGeometryChangedRateLimiter = new RateLimiter(4, Tiled.maxExternalFrameGeometryChangedIntervalMs);
            manager.connect(kwinClient.frameGeometryChanged, (oldGeometry) => {
                // on Wayland, this fires after `tileChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                    return;
                }
                const newGeometry = roundQtRect(client.kwinClient.frameGeometry);
                if (rectEquals(oldGeometry, newGeometry)) {
                    // no real changes, nothing to do
                    return;
                }
                const oldCenterX = oldGeometry.x + oldGeometry.width / 2;
                const oldCenterY = oldGeometry.y + oldGeometry.height / 2;
                const newCenterX = newGeometry.x + newGeometry.width / 2;
                const newCenterY = newGeometry.y + newGeometry.height / 2;
                const dx = Math.round(newCenterX - oldCenterX);
                const dy = Math.round(newCenterY - oldCenterY);
                if (dx !== 0 || dy !== 0) {
                    // TODO: instead of passing dx and dy, remember relative (to the parent) x and y for each
                    // transient window and use them for `moveTransients` and `ensureTransientsVisible`
                    client.moveTransients(dx, dy);
                }
                if (kwinClient.resize) {
                    world.do(() => {
                        if (newGeometry.width !== oldGeometry.width) {
                            window.column.onUserResizeWidth(resizeStartWidth, newGeometry.width - resizeStartWidth, newGeometry.x !== oldGeometry.x, resizeNeighbor);
                        }
                        if (newGeometry.height !== oldGeometry.height) {
                            window.column.adjustWindowHeight(window, newGeometry.height - oldGeometry.height, newGeometry.y !== oldGeometry.y);
                        }
                    });
                }
                else if (!window.column.grid.isUserResizing() &&
                    !client.isManipulatingGeometry(newGeometry) &&
                    client.getMaximizedMode() === 0 /* MaximizedMode.Unmaximized */ &&
                    !Clients.isFullScreenGeometry(kwinClient) // not using `kwinClient.fullScreen` because it may not be set yet at this point
                ) {
                    if (externalFrameGeometryChangedRateLimiter.acquire()) {
                        world.do(() => window.onFrameGeometryChanged());
                    }
                }
            });
            manager.connect(kwinClient.fullScreenChanged, () => {
                world.do((clientManager, desktopManager) => {
                    // some clients only turn out to be untileable after exiting full-screen mode
                    if (!Clients.canTileEver(kwinClient)) {
                        clientManager.floatClient(client);
                        return;
                    }
                    window.onFullScreenChanged(kwinClient.fullScreen);
                });
            });
            manager.connect(kwinClient.tileChanged, () => {
                // on X11, this fires after `frameGeometryChanged`
                if (kwinClient.tile !== null) {
                    world.do((clientManager, desktopManager) => {
                        clientManager.pinClient(kwinClient);
                    });
                }
            });
            return manager;
        }
        static getResizeNeighborColumn(window) {
            const eps = 20; // Detect edge near the edge as well
            const kwinClient = window.client.kwinClient;
            const column = window.column;
            if (Workspace.cursorPos.x > rectRightRound(kwinClient.clientGeometry) - eps) {
                return column.grid.getRightColumn(column);
            }
            else if (Workspace.cursorPos.x < kwinClient.clientGeometry.x.round() + eps) {
                return column.grid.getLeftColumn(column);
            }
            else {
                return null;
            }
        }
        static moveWindowToGrid(window, grid) {
            if (grid === window.column.grid) {
                // window already on the given grid
                return;
            }
            const newColumn = new Column(grid, grid.getLastFocusedColumn() ?? grid.getLastColumn());
            const passFocus = window.isFocused() ? 2 /* FocusPassing.Type.OnUnfocus */ : 0 /* FocusPassing.Type.None */;
            window.moveToColumn(newColumn, true, passFocus);
        }
        static prepareClientForTiling(client, config) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = true;
            }
            if (client.kwinClient.fullScreen) {
                if (config.maximizedKeepAbove) {
                    client.kwinClient.keepAbove = true;
                }
            }
            else {
                if (config.tiledKeepBelow) {
                    client.kwinClient.keepBelow = true;
                }
                client.kwinClient.keepAbove = false;
            }
            if (client.kwinClient.tile !== null) {
                client.setMaximize(false, true); // disable quick tile mode
            }
            client.setMaximize(false, false);
        }
        static restoreClientAfterTiling(client, config, defaultState, screenSize) {
            if (config.skipSwitcher) {
                client.kwinClient.skipSwitcher = defaultState.skipSwitcher;
            }
            if (config.tiledKeepBelow) {
                client.kwinClient.keepBelow = false;
            }
            if (config.offScreenOpacity < 1.0) {
                client.kwinClient.opacity = 1.0;
            }
            client.setFullScreen(false);
            if (client.kwinClient.tile === null) {
                client.setMaximize(false, false);
            }
            client.ensureVisible(screenSize);
        }
    }
    Tiled.maxExternalFrameGeometryChangedIntervalMs = 1000;
    ClientState.Tiled = Tiled;
})(ClientState || (ClientState = {}));
var ClientState;
(function (ClientState) {
    class TiledMinimized {
        constructor(world, client) {
            this.signalManager = TiledMinimized.initSignalManager(world, client);
        }
        destroy(passFocus) {
            this.signalManager.destroy();
        }
        static initSignalManager(world, client) {
            const manager = new SignalManager();
            manager.connect(client.kwinClient.minimizedChanged, () => {
                console.assert(!client.kwinClient.minimized);
                world.do((clientManager, desktopManager) => {
                    const desktop = desktopManager.getDesktopForClient(client.kwinClient);
                    if (desktop !== undefined) {
                        clientManager.tileClient(client, desktop.grid);
                    }
                    else {
                        clientManager.floatClient(client);
                    }
                });
            });
            return manager;
        }
    }
    ClientState.TiledMinimized = TiledMinimized;
})(ClientState || (ClientState = {}));
var Assert;
(function (Assert) {
    function assert(assertion, { message, skip = 0 } = {}) {
        if (assertion) {
            return;
        }
        if (message != undefined) {
            console.assert(assertion, message);
        }
        else {
            console.assert(assertion);
        }
        console.log(getStackTrace(skip + 1));
        console.log("Random branches:");
        if (runLog !== undefined) {
            for (const message of runLog) {
                console.log("    " + message);
            }
        }
        process.exit(1);
    }
    Assert.assert = assert;
    function getStackTrace(skip) {
        return new Error().stack.split("\n").slice(skip + 2).join("\n");
    }
    function appendMessage(base, message) {
        if (message === undefined) {
            return base;
        }
        return `${base}
    Message: ${message}`;
    }
    function buildMessage(actual, expected, header, message) {
        return appendMessage(`${header}
    Expected: ${expected}
    Actual: ${actual}`, message);
    }
    function equal(actual, expected, { message, skip = 0 } = {}) {
        assert(expected === actual, {
            message: buildMessage(actual, expected, "Values not equal", message),
            skip: skip + 1,
        });
    }
    Assert.equal = equal;
    function equalArrays(actual, expected, { message, skip = 0 } = {}) {
        assert(actual.length === expected.length && actual.every((item, index) => item === expected[index]), {
            message: buildMessage(actual, expected, "Arrays not equal", message),
            skip: skip + 1,
        });
    }
    Assert.equalArrays = equalArrays;
    function between(actual, min, max, { message, skip = 0 } = {}) {
        assert(actual >= min && actual <= max, {
            message: buildMessage(actual, `[${min}, ${max}]`, "Value not in range", message),
            skip: skip + 1,
        });
    }
    Assert.between = between;
    function equalRects(actual, expected, { message, skip = 0 } = {}) {
        assert(rectEquals(expected, actual), {
            message: buildMessage(actual, expected, "QmlRect not equal", message),
            skip: skip + 1,
        });
    }
    Assert.equalRects = equalRects;
    function rect(actual, x, y, width, height, { message, skip = 0 } = {}) {
        equalRects(actual, new MockQmlRect(x, y, width, height), { message: message, skip: skip + 1 });
    }
    Assert.rect = rect;
    function grid(config, tilingArea, columnWidths, grid, centered, stackedColumns = [], { message, skip = 0 } = {}) {
        const nColumns = grid.length;
        function getGridWidth() {
            function getColumnsWidth() {
                if (columnWidths instanceof Array) {
                    let columnsWidth = 0;
                    for (const columnWidth of columnWidths) {
                        columnsWidth += columnWidth;
                    }
                    return columnsWidth;
                }
                else {
                    return nColumns * columnWidths;
                }
            }
            const gapsWidth = (nColumns - 1) * config.gapsInnerHorizontal;
            return getColumnsWidth() + gapsWidth;
        }
        function getColumnWidth(column) {
            if (columnWidths instanceof Array) {
                return columnWidths[column];
            }
            else {
                return columnWidths;
            }
        }
        const gridWidth = getGridWidth();
        const startX = centered ?
            tilingArea.x + (tilingArea.width - gridWidth) / 2 :
            grid[0][0].getActualFrameGeometry().x;
        function getColumnX(column) {
            if (columnWidths instanceof Array) {
                let x = startX;
                for (let i = 0; i < column; i++) {
                    x += columnWidths[i] + config.gapsInnerHorizontal;
                }
                return x;
            }
            else {
                return startX + column * (columnWidths + config.gapsInnerHorizontal);
            }
        }
        // assumes uniformly sized windows within columns of uniform width
        function getRectInGrid(column, window, nColumns, nWindows) {
            const columnWidth = getColumnWidth(column);
            const windowHeight = (tilingArea.height - config.gapsInnerVertical * (nWindows - 1)) / nWindows;
            return new MockQmlRect(getColumnX(column), tilingArea.y + (windowHeight + config.gapsInnerVertical) * window, columnWidth, (tilingArea.height - config.gapsInnerVertical * (nWindows - 1)) / nWindows);
        }
        function getRectInGridStacked(column, window, nColumns, nWindows) {
            const columnWidth = getColumnWidth(column);
            return new MockQmlRect(getColumnX(column) + window * config.stackOffsetX, tilingArea.y + window * config.stackOffsetY, columnWidth - (nWindows - 1) * config.stackOffsetX, tilingArea.height - (nWindows - 1) * config.stackOffsetY);
        }
        for (let iColumn = 0; iColumn < nColumns; iColumn++) {
            const column = grid[iColumn];
            const stacked = stackedColumns.includes(iColumn);
            const getRect = stacked ? getRectInGridStacked : getRectInGrid;
            const nWindows = column.length;
            for (let iWindow = 0; iWindow < nWindows; iWindow++) {
                const window = column[iWindow];
                equalRects(window.getActualFrameGeometry(), getRect(iColumn, iWindow, nColumns, nWindows), { message: appendMessage(`column ${iColumn}, window ${iWindow}`, message), skip: skip + 1 });
            }
        }
    }
    Assert.grid = grid;
    function centered(config, tilingArea, client, { message, skip = 0 } = {}) {
        grid(config, tilingArea, client.getActualFrameGeometry().width, [[client]], true, [], { message: appendMessage("Window not centered", message), skip: skip + 1 });
    }
    Assert.centered = centered;
    function fullyVisible(rect, { message, skip = 0 } = {}) {
        assert(rect.x >= tilingArea.x && rectRight(rect) <= rectRight(tilingArea), {
            message: appendMessage(`Rect ${rect} not fully visible`, message),
            skip: skip + 1,
        });
    }
    Assert.fullyVisible = fullyVisible;
    function notFullyVisible(rect, { message, skip = 0 } = {}) {
        assert(rect.x < tilingArea.x || rectRight(rect) > rectRight(tilingArea), {
            message: appendMessage(`Rect ${rect} is fully visible, but shouldn't be`, message),
            skip: skip + 1,
        });
    }
    Assert.notFullyVisible = notFullyVisible;
    function columnsFillTilingArea(columns, { message, skip = 0 } = {}) {
        const options = { message: message, skip: skip + 1 };
        let x = tilingArea.x;
        for (const column of columns) {
            const width = column.getActualFrameGeometry().width;
            fullyVisible(column.getActualFrameGeometry(), options);
            rect(column.getActualFrameGeometry(), x, tilingArea.y, width, tilingArea.height, options);
            x += width + gapH;
        }
        equal(rectRight(columns[columns.length - 1].getActualFrameGeometry()), rectRight(tilingArea), options);
    }
    Assert.columnsFillTilingArea = columnsFillTilingArea;
    function tiledClient(clientManager, client, { message, skip = 0 } = {}) {
        assert(clientManager.findTiledWindow(client) !== null, { message: message, skip: skip + 1 });
    }
    Assert.tiledClient = tiledClient;
    function notTiledClient(clientManager, client, { message, skip = 0 } = {}) {
        assert(clientManager.findTiledWindow(client) === null, { message: message, skip: skip + 1 });
    }
    Assert.notTiledClient = notTiledClient;
})(Assert || (Assert = {}));
class TestRunner {
    constructor() {
        this.tests = [];
    }
    register(name, count, f) {
        this.tests.push({ name: name, count: count, f: f });
    }
    run() {
        const nameRegexp = new RegExp(process.argv[2]);
        for (const test of this.tests) {
            if (nameRegexp.test(test.name)) {
                console.log("Running test " + test.name);
                for (let i = 0; i < test.count; i++) {
                    test.f();
                }
            }
        }
    }
}
const tests = new TestRunner();
function getDefaultConfig() {
    const config = {};
    for (const prop of configDef) {
        config[prop.name] = prop.default;
    }
    return config;
}
let Qt;
let KWin;
let Workspace;
let qmlBase;
let notificationInvalidTiledDesktops;
let notificationInvalidWindowRules;
let notificationInvalidPresetWidths;
let moveCursorToFocus;
let screen;
let tilingArea;
let gapH;
let gapV;
let runLog;
function init(config) {
    screen = new MockQmlRect(0, 0, 800, 600);
    tilingArea = new MockQmlRect(config.gapsOuterLeft, config.gapsOuterTop, screen.width - config.gapsOuterLeft - config.gapsOuterRight, screen.height - config.gapsOuterTop - config.gapsOuterBottom);
    gapH = config.gapsInnerHorizontal;
    gapV = config.gapsInnerVertical;
    runLog = [];
    const qtMock = new MockQt();
    const workspaceMock = new MockWorkspace();
    Qt = qtMock;
    Workspace = workspaceMock;
    moveCursorToFocus = {
        __brand: "QmlObject",
        call: () => {
            Assert.assert(Workspace.activeWindow !== null, { message: "moveCursorToFocus should never be called if there's no focused window" });
            const frame = Workspace.activeWindow.getActualFrameGeometry();
            workspaceMock.cursorPos.x = Math.floor(frame.x + frame.width / 2);
            workspaceMock.cursorPos.y = Math.floor(frame.y + frame.height / 2);
        },
    };
    const world = new World(config);
    return { qtMock, workspaceMock, world };
}
function getGridBounds(clientLeft, clientRight) {
    const columnsWidth = rectRight(clientRight.getActualFrameGeometry()) - clientLeft.getActualFrameGeometry().x;
    const left = tilingArea.x + Math.floor((tilingArea.width - columnsWidth) / 2);
    const right = left + columnsWidth;
    return { left, right };
}
function getWindowHeight(windowsInColumn) {
    const totalGaps = (windowsInColumn - 1) * gapV;
    return Math.round((tilingArea.height - totalGaps) / windowsInColumn);
}
function getClientManager(world) {
    // don't do this outside of tests
    let clientManager;
    world.do((cm, dm) => clientManager = cm);
    return clientManager;
}
function activateRandomWindowOnDesktop(desktop) {
    const windows = Workspace.windows.filter(w => w.desktops.includes(desktop));
    if (windows.length > 0) {
        Workspace.activeWindow = randomItem(windows);
    }
}
function runMaybe(f) {
    if (Math.random() < 0.5) {
        f();
    }
}
function runOneOf(...fs) {
    const index = randomInt(fs.length);
    runLog.push(`${getStackFrame(1)} - Chose ${index}`);
    return fs[index]();
}
function runReorder(...fs) {
    const fis = fs.map((f, index) => ({ f: f, index: index }));
    shuffle(fis);
    const indexes = fis.map((fi) => fi.index);
    runLog.push(`${getStackFrame(1)} - Order ${indexes}`);
    for (const fi of fis) {
        fi.f();
    }
}
function runReorderDebug(order, ...fs) {
    for (const index of order) {
        fs[index]();
    }
}
function randomJitter() {
    if (Math.random() < 0.25) {
        return (Math.random() - 0.5) * 0.5;
    }
    else {
        return 0;
    }
}
function randomInt(n) {
    return Math.floor(Math.random() * n);
}
function randomItem(items) {
    Assert.assert(items.length > 0);
    const index = randomInt(items.length);
    return items[index];
}
function shuffle(items) {
    for (let n = items.length; n > 1; n--) {
        const i = n - 1;
        const j = randomInt(n);
        [items[i], items[j]] = [items[j], items[i]];
    }
}
function getStackFrame(index) {
    return new Error().stack.split("\n")[index + 2].substring(7);
}
function timeControl(f) {
    const originalDateNow = Date.now;
    let currentTime = Date.now();
    Date.now = () => currentTime;
    function addTime(ms) {
        currentTime += ms;
    }
    f(addTime);
    Date.now = originalDateNow;
}
class MockKwinClient {
    constructor(_frameGeometry = new MockQmlRect(10, 10, 100, 200), transientFor = null) {
        this._frameGeometry = _frameGeometry;
        this.transientFor = transientFor;
        this.__brand = "KwinClient";
        this.caption = "App";
        this.minSize = new MockQmlSize(randomJitter(), randomJitter());
        this.maxSize = new MockQmlSize(9999, 9999);
        this.move = false;
        this.resize = false;
        this.fullScreenable = true;
        this.maximizable = true;
        this.output = { __brand: "Output" };
        this.resourceClass = "app";
        this.dock = false;
        this.normalWindow = true;
        this.managed = true;
        this.popupWindow = false;
        this.modal = false;
        this.pid = 1;
        this._maximizedVertically = false;
        this._maximizedHorizontally = false;
        this._fullScreen = false;
        this.activities = [];
        this.skipSwitcher = false;
        this.keepAbove = false;
        this.keepBelow = false;
        this._minimized = false;
        this._desktops = [];
        this._tile = null;
        this.opacity = 1.0;
        this.fullScreenChanged = new MockQSignal();
        this.desktopsChanged = new MockQSignal();
        this.activitiesChanged = new MockQSignal();
        this.minimizedChanged = new MockQSignal();
        this.maximizedAboutToChange = new MockQSignal();
        this.captionChanged = new MockQSignal();
        this.tileChanged = new MockQSignal();
        this.interactiveMoveResizeStarted = new MockQSignal();
        this.interactiveMoveResizeFinished = new MockQSignal();
        this.frameGeometryChanged = new MockQSignal();
        this.windowed = true;
        this.hasBorder = true;
        this.windowedFrameGeometry = _frameGeometry.clone();
        this.transient = transientFor !== null;
        this._desktops = [Workspace.currentDesktop];
        this.activities = [Workspace.currentActivity];
    }
    setMaximize(vertically, horizontally) {
        this.windowed = !(vertically || horizontally);
        if (vertically === this._maximizedVertically && horizontally === this._maximizedHorizontally) {
            return;
        }
        this._maximizedVertically = vertically;
        this._maximizedHorizontally = horizontally;
        this.maximizedAboutToChange.fire(vertically ? (horizontally ? 3 /* MaximizedMode.Maximized */ : 1 /* MaximizedMode.Vertically */) : (horizontally ? 2 /* MaximizedMode.Horizontally */ : 0 /* MaximizedMode.Unmaximized */));
        this.frameGeometry = new MockQmlRect(horizontally ? 0 : this.windowedFrameGeometry.x, vertically ? 0 : this.windowedFrameGeometry.y, horizontally ? screen.width : this.windowedFrameGeometry.width, vertically ? screen.height : this.windowedFrameGeometry.height);
    }
    get clientGeometry() {
        if (this.hasBorder) {
            return new MockQmlRect(this.frameGeometry.x + MockKwinClient.borderThickness, this.frameGeometry.y + MockKwinClient.borderThickness, this.frameGeometry.width - 2 * MockKwinClient.borderThickness, this.frameGeometry.height - 2 * MockKwinClient.borderThickness);
        }
        else {
            return runOneOf(() => this.frameGeometry, () => new MockQmlRect(this.frameGeometry.x - 20, this.frameGeometry.y - 20, this.frameGeometry.width + 40, this.frameGeometry.height + 40));
        }
    }
    get moveable() {
        return !this._fullScreen;
    }
    get resizeable() {
        return !this._fullScreen;
    }
    get fullScreen() {
        return this._fullScreen;
    }
    set fullScreen(fullScreen) {
        const oldFullScreen = this._fullScreen;
        this.hasBorder = !fullScreen;
        const targetFrameGeometry = fullScreen ? screen : this.windowedFrameGeometry;
        runReorder(() => {
            this._fullScreen = fullScreen;
            if (fullScreen !== oldFullScreen) {
                this.fullScreenChanged.fire();
            }
        }, () => {
            if (oldFullScreen && !fullScreen) {
                // when switching from full-screen to windowed, Kwin sometimes first adds the frame before changing the frameGeometry to the final value
                if (!rectEquals(this.frameGeometry, screen)) {
                    // already has windowed frame geometry, don't undo that
                    return;
                }
                runOneOf(() => {
                    this.frameGeometry = new MockQmlRect(0, 0, screen.width + 2 * MockKwinClient.borderThickness, screen.height + 2 * MockKwinClient.borderThickness);
                }, () => {
                    this.frameGeometry = new MockQmlRect(-MockKwinClient.borderThickness, -MockKwinClient.borderThickness, screen.width + 2 * MockKwinClient.borderThickness, screen.height + 2 * MockKwinClient.borderThickness);
                }, () => { });
            }
        }, () => {
            this.windowed = !fullScreen;
            this.frameGeometry = targetFrameGeometry;
        });
    }
    // for assertions
    getActualFrameGeometry() {
        return this._frameGeometry;
    }
    // for Karousel
    get frameGeometry() {
        return new MockQmlRect(this._frameGeometry.x + randomJitter(), this._frameGeometry.y + randomJitter(), this._frameGeometry.width + randomJitter(), this._frameGeometry.height + randomJitter(), this.frameGeometryChanged.fire.bind(this.frameGeometryChanged));
    }
    set frameGeometry(frameGeometry) {
        const oldFrameGeometry = this._frameGeometry;
        this._frameGeometry = new MockQmlRect(frameGeometry.x, frameGeometry.y, frameGeometry.width, frameGeometry.height, this.frameGeometryChanged.fire.bind(this.frameGeometryChanged));
        if (this.windowed) {
            this.windowedFrameGeometry = this._frameGeometry.clone();
        }
        if (!rectEquals(frameGeometry, oldFrameGeometry)) {
            this.frameGeometryChanged.fire(oldFrameGeometry);
        }
    }
    get minimized() {
        return this._minimized;
    }
    set minimized(minimized) {
        this._minimized = minimized;
        this.minimizedChanged.fire();
    }
    get desktops() {
        return this._desktops;
    }
    set desktops(desktops) {
        this._desktops = desktops;
        this.desktopsChanged.fire();
        if (Workspace.activeWindow === this && !desktops.includes(Workspace.currentDesktop)) {
            Workspace.activeWindow = null;
            runMaybe(() => Workspace.activeWindow = null); // fired again for some reason
            if (Workspace.activeWindow === null) {
                activateRandomWindowOnDesktop(Workspace.currentDesktop);
            }
        }
        ;
    }
    moveAndFollowToDesktop(desktop, workspaceMock) {
        Assert.assert(workspaceMock.activeWindow === this);
        this._desktops = [desktop];
        this.desktopsChanged.fire();
        workspaceMock.currentDesktop = desktop;
    }
    get tile() {
        return this._tile;
    }
    set tile(tile) {
        this._tile = tile;
        this.tileChanged.fire();
    }
    pin(geometry) {
        runMaybe(() => this.frameGeometry = geometry);
        this.tile = { __brand: "Tile" };
        this.frameGeometry = geometry;
    }
    unpin() {
        this.tile = null;
    }
    getFrameGeometryCopy() {
        return this._frameGeometry.clone();
    }
    toString() {
        return `MockKwinClient("${this.caption}")`;
    }
}
MockKwinClient.borderThickness = 10;
class MockQSignal {
    constructor() {
        this.__brand = "QSignal";
        this.handlers = new Set();
    }
    connect(handler) {
        this.handlers.add(handler);
    }
    ;
    disconnect(handler) {
        this.handlers.delete(handler);
    }
    ;
    fire(...args) {
        for (const handler of this.handlers) {
            handler(...args);
        }
    }
}
class MockQmlPoint {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.__brand = "QmlPoint";
    }
    clone() {
        return new MockQmlPoint(this.x, this.y);
    }
}
class MockQmlRect {
    constructor(_x, _y, _width, _height, onChanged = () => { }) {
        this._x = _x;
        this._y = _y;
        this._width = _width;
        this._height = _height;
        this.onChanged = onChanged;
        this.__brand = "QmlRect";
    }
    get x() {
        return this._x;
    }
    set x(x) {
        const oldRect = this.clone();
        this._x = x;
        this.onChanged(oldRect);
    }
    get y() {
        return this._y;
    }
    set y(y) {
        const oldRect = this.clone();
        this._y = y;
        this.onChanged(oldRect);
    }
    get width() {
        return this._width;
    }
    set width(width) {
        const oldRect = this.clone();
        this._width = width;
        this.onChanged(oldRect);
    }
    get height() {
        return this._height;
    }
    set height(height) {
        const oldRect = this.clone();
        this._height = height;
        this.onChanged(oldRect);
    }
    set(target) {
        const oldRect = this.clone();
        this._x = target.x;
        this._y = target.y;
        this._width = target.width;
        this._height = target.height;
        this.onChanged(oldRect);
    }
    clone() {
        return new MockQmlRect(this._x, this._y, this._width, this._height);
    }
    toString() {
        return `(${this.x} ${this.y} ${this.width} ${this.height})`;
    }
}
class MockQmlSize {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.__brand = "QmlSize";
    }
}
class MockQmlTimer {
    constructor() {
        this.__brand = "QmlObject";
        this.interval = 0;
        this.triggered = new MockQSignal();
    }
    restart() {
        // no need to wait in tests, just fire immediately
        this.triggered.fire();
    }
    ;
    destroy() { }
}
class MockQt {
    constructor() {
        this.__brand = "Qt";
        this.shortcuts = new Map();
    }
    point(x, y) {
        return new MockQmlPoint(x, y);
    }
    rect(x, y, width, height) {
        return new MockQmlRect(x, y, width, height);
    }
    createQmlObject(qml, parent) {
        if (qml.includes("Timer")) {
            return new MockQmlTimer();
        }
        else if (qml.includes("ShortcutHandler")) {
            const shortcutName = MockQt.extractShortcutName(qml);
            const shortcutHandler = new MockShortcutHandler();
            this.shortcuts.set(shortcutName, shortcutHandler);
            return shortcutHandler;
        }
        else {
            throw new Error("Unexpected qml string: " + qml);
        }
    }
    fireShortcut(shortcutName) {
        const shortcutHandler = this.shortcuts.get(shortcutName);
        if (shortcutHandler === undefined) {
            Assert.assert(false);
            return;
        }
        shortcutHandler.activated.fire();
    }
    static extractShortcutName(qml) {
        const nameLine = qml.split("\n").find((line) => line.trimStart().startsWith("name:"));
        if (nameLine === undefined) {
            Assert.assert(false);
            return "";
        }
        return nameLine.substring(nameLine.indexOf('"') + 1, nameLine.lastIndexOf('"'));
    }
}
class MockShortcutHandler {
    constructor() {
        this.__brand = "QmlObject";
        this.activated = new MockQSignal();
    }
    destroy() { }
}
class MockWorkspace {
    constructor() {
        this.__brand = "Workspace";
        this.activities = ["test-activity"];
        this.desktops = [
            { __brand: "KwinDesktop", id: "desktop1", name: "Desktop 1" },
            { __brand: "KwinDesktop", id: "desktop2", name: "Desktop 2" },
        ];
        this.currentActivity = this.activities[0];
        this.activeScreen = { __brand: "Output" };
        this.windows = [];
        this.cursorPos = new MockQmlPoint(0, 0);
        this._currentDesktop = this.desktops[0];
        this._activeWindow = null;
        this.currentDesktopChanged = new MockQSignal();
        this.windowAdded = new MockQSignal();
        this.windowRemoved = new MockQSignal();
        this.windowActivated = new MockQSignal();
        this.screensChanged = new MockQSignal();
        this.activitiesChanged = new MockQSignal();
        this.desktopsChanged = new MockQSignal();
        this.currentActivityChanged = new MockQSignal();
        this.virtualScreenSizeChanged = new MockQSignal();
    }
    clientArea(option, output, kwinDesktop) {
        return screen;
    }
    raiseWindow(kwinClient) { }
    createWindows(...kwinClients) {
        for (const kwinClient of kwinClients) {
            this.windows.push(kwinClient);
            this.windowAdded.fire(kwinClient);
            this.activeWindow = kwinClient;
        }
    }
    createClients(n) {
        return this.createClientsWithWidths(...Array(n).fill(100));
    }
    createClientsWithFrames(...frames) {
        const clients = frames.map(rect => new MockKwinClient(rect));
        clients.forEach((client, index) => client.caption = `Client ${index}`);
        this.createWindows(...clients);
        return clients;
    }
    createClientsWithWidths(...widths) {
        return this.createClientsWithFrames(...widths.map(width => new MockQmlRect(randomInt(100), randomInt(100), width, 100 + randomInt(400))));
    }
    removeWindow(window) {
        this.activeWindow = null;
        runReorder(() => this.windows.splice(this.windows.indexOf(window), 1), () => this.windowRemoved.fire(window));
        if (this.activeWindow === null) {
            activateRandomWindowOnDesktop(this.currentDesktop);
        }
        ;
    }
    moveWindow(window, ...deltas) {
        const frame = window.getFrameGeometryCopy();
        window.move = true;
        window.interactiveMoveResizeStarted.fire();
        for (const delta of deltas) {
            if (delta.x !== 0) {
                frame.x += delta.x;
            }
            if (delta.y !== 0) {
                frame.y += delta.y;
            }
            runOneOf(() => window.getActualFrameGeometry().set(frame), () => window.frameGeometry = frame);
        }
        window.move = false;
        window.interactiveMoveResizeFinished.fire();
    }
    resizeWindow(window, edgeResize, leftEdge, topEdge, ...deltas) {
        const frame = window.getFrameGeometryCopy();
        if (edgeResize) {
            this.cursorPos = new MockQmlPoint(leftEdge ? frame.x : rectRight(frame), topEdge ? frame.y : rectBottom(frame));
        }
        else {
            this.cursorPos = new MockQmlPoint(Math.round(frame.x + frame.width / 2), Math.round(frame.y + frame.height / 2));
        }
        window.resize = true;
        window.interactiveMoveResizeStarted.fire();
        for (const delta of deltas) {
            if (delta.width !== 0) {
                frame.width += delta.width;
                if (leftEdge) {
                    frame.x -= delta.width;
                }
            }
            if (delta.height !== 0) {
                frame.height += delta.height;
                if (topEdge) {
                    frame.y -= delta.height;
                }
            }
            runOneOf(() => window.getActualFrameGeometry().set(frame), () => window.frameGeometry = frame);
        }
        window.resize = false;
        window.interactiveMoveResizeFinished.fire();
    }
    get currentDesktop() {
        return this._currentDesktop;
    }
    set currentDesktop(currentDesktop) {
        this._currentDesktop = currentDesktop;
        this.currentDesktopChanged.fire();
    }
    get activeWindow() {
        return this._activeWindow;
    }
    set activeWindow(activeWindow) {
        this._activeWindow = activeWindow;
        this.windowActivated.fire(activeWindow);
    }
}
tests.register("PresetWidths", 1, () => {
    const tilingAreaWidth = 800;
    const spacing = 10;
    const minWidth = 50;
    const maxWidth = tilingAreaWidth;
    const testCases = [
        { str: "100%, 50%", result: [395, 800] },
        { str: "105%, 50%", result: [395, 800] },
        { str: "100px,50 px", result: [50, 100] },
        { str: "900px,25 px", result: [50, 800] },
        { str: " 100px, 25 % , 0.1 ", result: [71, 100, 192] },
        { str: "100px, 25%, 0.1, 100px", result: [71, 100, 192] },
        { str: "100px, -25 % , 0.1 ", error: true },
        { str: "100px, 25 % , -0.1 ", error: true },
        { str: "100px, 25 % , 0.1p", error: true },
        { str: "100px, % , 0.1 ", error: true },
        { str: "100px,  , 0.1 ", error: true },
        { str: "100px, 0, 0.1 ", error: true },
        { str: "100px,, 0.1 ", error: true },
        { str: "100px, 25 % , ", error: true },
        { str: "asdf", error: true },
        { str: "", error: true },
        { str: " ", error: true },
    ];
    function assertWidths(presetWidths, expectedWidths) {
        let currentWidth = 0;
        for (const expectedWidth of expectedWidths) {
            currentWidth = presetWidths.next(currentWidth, minWidth, maxWidth, tilingAreaWidth);
            Assert.equal(currentWidth, expectedWidth);
        }
        const repeatedWidth = presetWidths.next(currentWidth, minWidth, maxWidth, tilingAreaWidth);
        Assert.equal(repeatedWidth, expectedWidths[0]);
    }
    for (const testCase of testCases) {
        try {
            const presetWidths = new PresetWidths(testCase.str, spacing);
            Assert.assert(!testCase.error);
            assertWidths(presetWidths, testCase.result);
        }
        catch (error) {
            Assert.assert(testCase.error === true);
        }
    }
});
tests.register("DesktopFilter", 1, () => {
    const desktop1 = { __brand: "KwinDesktop", id: "1", name: "Desktop 1" };
    const desktop2 = { __brand: "KwinDesktop", id: "2", name: "Work" };
    const desktop3 = { __brand: "KwinDesktop", id: "3", name: "Desktop 2" };
    // Test 1: Empty config means all desktops
    let filter = new DesktopFilter("");
    Assert.assert(filter.shouldWorkOnDesktop(desktop1), { message: "Empty config should work on desktop1" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop2), { message: "Empty config should work on desktop2" });
    // Test 2: Whitespace only means all desktops
    filter = new DesktopFilter("  \n  \n  ");
    Assert.assert(filter.shouldWorkOnDesktop(desktop1), { message: "Whitespace only should work on desktop1" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop2), { message: "Whitespace only should work on desktop2" });
    // Test 3: Match all regex pattern
    filter = new DesktopFilter(".*");
    Assert.assert(filter.shouldWorkOnDesktop(desktop1), { message: "Regex '.*' should work on desktop1" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop2), { message: "Regex '.*' should work on desktop2" });
    // Test 4: Partial match without anchors
    filter = new DesktopFilter("Work");
    Assert.assert(!filter.shouldWorkOnDesktop(desktop1), { message: "Should not work on desktop1" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop2), { message: "Should work on desktop2 containing 'Work'" });
    // Test 5: Regex alternation for multiple desktops
    filter = new DesktopFilter("Desktop 1|Work");
    Assert.assert(filter.shouldWorkOnDesktop(desktop1), { message: "Should work on desktop1" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop2), { message: "Should work on desktop2" });
    Assert.assert(!filter.shouldWorkOnDesktop(desktop3), { message: "Should not work on desktop3" });
    // Test 6: Regex pattern with character class
    filter = new DesktopFilter("Desktop [12]");
    Assert.assert(filter.shouldWorkOnDesktop(desktop1), { message: "Should work on desktop1" });
    Assert.assert(!filter.shouldWorkOnDesktop(desktop2), { message: "Should not work on desktop2" });
    Assert.assert(filter.shouldWorkOnDesktop(desktop3), { message: "Should work on desktop3" });
    // Test 7: Case-sensitive matching
    filter = new DesktopFilter("work");
    Assert.assert(!filter.shouldWorkOnDesktop(desktop2), { message: "Should not work on desktop2 (case mismatch)" });
});
tests.register("WindowRuleEnforcer", 1, () => {
    screen = new MockQmlRect(0, 0, 800, 600);
    Workspace = new MockWorkspace();
    const testCases = [
        { tiledByDefault: true, resourceClass: "unknown", caption: "anything", shouldTile: true },
        { tiledByDefault: false, resourceClass: "unknown", caption: "anything", shouldTile: false },
        { tiledByDefault: true, resourceClass: "org.kde.plasmashell", caption: "something", shouldTile: false },
        { tiledByDefault: true, resourceClass: "plasmashell", caption: "something", shouldTile: false },
        { tiledByDefault: false, resourceClass: "org.kde.kfind", caption: "something", shouldTile: true },
        { tiledByDefault: false, resourceClass: "kfind", caption: "something", shouldTile: true },
        { tiledByDefault: true, resourceClass: "org.kde.kruler", caption: "anything", shouldTile: false },
        { tiledByDefault: true, resourceClass: "kruler", caption: "anything", shouldTile: false },
        { tiledByDefault: true, resourceClass: "zoom", caption: "something", shouldTile: true },
        { tiledByDefault: true, resourceClass: "zoom", caption: "zoom", shouldTile: false },
    ];
    const enforcer = new WindowRuleEnforcer(JSON.parse(defaultWindowRules));
    for (const testCase of testCases) {
        const kwinClient = createKwinClient(testCase.tiledByDefault, testCase.resourceClass, testCase.caption);
        Assert.assert(enforcer.shouldTile(kwinClient) === testCase.shouldTile, { message: "failed case: " + JSON.stringify(testCase) });
    }
    function createKwinClient(normalWindow, resourceClass, caption) {
        return {
            normalWindow: normalWindow,
            transient: false,
            clientGeometry: new MockQmlRect(0, 0, 200, 200),
            managed: true,
            pid: 100,
            moveable: true,
            resizeable: true,
            popupWindow: false,
            minimized: false,
            desktops: [1],
            activities: [1],
            resourceClass: resourceClass,
            caption: caption,
        };
    }
});
tests.register("RateLimiter", 1, () => {
    const rateLimiter = new RateLimiter(3, 100);
    function testRateLimiter() {
        Assert.assert(rateLimiter.acquire());
        Assert.assert(rateLimiter.acquire());
        Assert.assert(rateLimiter.acquire());
        Assert.assert(!rateLimiter.acquire());
        Assert.assert(!rateLimiter.acquire());
    }
    timeControl(addTime => {
        testRateLimiter();
        addTime(10);
        Assert.assert(!rateLimiter.acquire(), { message: "The interval hasn't expired yet" });
        addTime(90);
        // the rate limiter interval has expired, let's test again
        testRateLimiter();
    });
});
tests.register("fillSpace", 1, () => {
    const testCases = [
        {
            availableSpace: 600,
            items: [],
            expected: [],
        },
        {
            availableSpace: 600,
            items: [
                { min: 10, max: 600 },
                { min: 10, max: 600 },
            ],
            expected: [300, 300],
        },
        {
            availableSpace: 700,
            items: [
                { min: 300, max: 300 },
                { min: 300, max: 300 },
            ],
            expected: [300, 300],
        },
        {
            availableSpace: 700,
            items: [
                { min: 300, max: 300 },
                { min: 300, max: 300 },
                { min: 10, max: 900 },
            ],
            expected: [300, 300, 100],
        },
        {
            availableSpace: 600,
            items: [
                { min: 10, max: 250 },
                { min: 10, max: 500 },
            ],
            expected: [250, 350],
        },
        {
            availableSpace: 600,
            items: [
                { min: 10, max: 250 },
                { min: 400, max: 500 },
            ],
            expected: [200, 400],
        },
        {
            availableSpace: 765,
            items: [
                { min: 10, max: 250 },
                { min: 10, max: 254 },
                { min: 10, max: 500 },
            ],
            expected: [250, 254, 261],
        },
        {
            availableSpace: 600,
            items: [
                { min: 10, max: 150 },
                { min: 400, max: 500 },
            ],
            expected: [150, 450],
        },
        {
            availableSpace: 750,
            items: [
                { min: 10, max: 250 },
                { min: 10, max: 250 },
                { min: 400, max: 500 },
                { min: 10, max: 300 },
            ],
            expected: [117, 117, 400, 116],
        },
        {
            availableSpace: 750,
            items: [
                { min: 10, max: 250 },
                { min: 120, max: 250 },
                { min: 400, max: 500 },
                { min: 10, max: 300 },
            ],
            expected: [115, 120, 400, 115],
        },
        {
            availableSpace: 1200,
            items: [
                { min: 10, max: 250 },
                { min: 10, max: 500 },
            ],
            expected: [250, 500],
        },
        {
            availableSpace: 5,
            items: [
                { min: 10, max: 250 },
                { min: 10, max: 500 },
            ],
            expected: [10, 10],
        },
        {
            availableSpace: 800,
            items: [
                { min: 114, max: 800 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 109, max: 800 },
                { min: 10, max: 800 },
            ],
            expected: [114, 93, 93, 93, 93, 93, 111, 110],
        },
        {
            availableSpace: 801,
            items: [
                { min: 114, max: 800 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 109, max: 800 },
                { min: 10, max: 800 },
            ],
            expected: [114, 93, 93, 93, 93, 93, 111, 111],
        },
        {
            availableSpace: 801,
            items: [
                { min: 114, max: 800 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 109, max: 800 },
                { min: 10, max: 95 },
            ],
            expected: [121, 93, 93, 93, 93, 93, 120, 95],
        },
        {
            availableSpace: 799,
            items: [
                { min: 10, max: 86 },
                { min: 107, max: 800 },
                { min: 107, max: 800 },
                { min: 107, max: 800 },
                { min: 107, max: 800 },
                { min: 107, max: 800 },
                { min: 10, max: 91 },
                { min: 105, max: 800 },
            ],
            expected: [80, 107, 107, 107, 107, 107, 79, 105],
        },
        {
            availableSpace: 1029,
            items: [
                { min: 114, max: 800 },
                { min: 114, max: 800 },
                { min: 114, max: 800 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 10, max: 93 },
                { min: 109, max: 800 },
                { min: 10, max: 800 },
            ],
            expected: [114, 114, 114, 93, 93, 93, 93, 93, 111, 111],
        },
        {
            availableSpace: 602,
            items: [
                { min: 10, max: 600 },
                { min: 10, max: 600 },
                { min: 10, max: 600 },
            ],
            expected: [200, 200, 200],
        },
        {
            availableSpace: 602,
            items: [
                { min: 204, max: 600 },
                { min: 202, max: 600 },
                { min: 10, max: 600 },
            ],
            expected: [204, 202, 196],
        },
        {
            availableSpace: 803,
            items: [
                { min: 204, max: 600 },
                { min: 10, max: 600 },
                { min: 10, max: 600 },
                { min: 10, max: 600 },
            ],
            expected: [204, 200, 200, 199],
        },
        {
            availableSpace: 900,
            items: [
                { min: 10, max: 120 },
                { min: 10, max: 250 },
                { min: 500, max: 500 },
                { min: 300, max: 500 },
            ],
            expected: [50, 50, 500, 300],
        },
        {
            availableSpace: 845,
            items: [
                { min: 5, max: 5 },
                { min: 10, max: 40 },
                { min: 500, max: 500 },
                { min: 300, max: 500 },
            ],
            expected: [5, 40, 500, 300],
        },
        {
            availableSpace: 800,
            items: [
                { min: 10, max: 20 },
                { min: 220, max: 221 },
                { min: 250, max: 260 },
                { min: 300, max: 305 },
            ],
            expected: [20, 221, 259, 300],
        },
    ];
    for (const testCase of testCases) {
        const result = fillSpace(testCase.availableSpace, testCase.items);
        Assert.equalArrays(result, testCase.expected, { message: JSON.stringify(testCase) });
    }
});
tests.register("math", 1, () => {
    const rect = new MockQmlRect(100, 200, 10, 20);
    const testCases = [
        {
            rect: rect,
            point: new MockQmlPoint(100, 200),
            contained: true,
        },
        {
            rect: rect,
            point: new MockQmlPoint(110, 220),
            contained: true,
        },
        {
            rect: rect,
            point: new MockQmlPoint(105, 205),
            contained: true,
        },
        {
            rect: rect,
            point: new MockQmlPoint(110.01, 205),
            contained: false,
        },
        {
            rect: rect,
            point: new MockQmlPoint(105, 220.01),
            contained: false,
        },
        {
            rect: rect,
            point: new MockQmlPoint(16, 205),
            contained: false,
        },
        {
            rect: rect,
            point: new MockQmlPoint(105, 16),
            contained: false,
        },
    ];
    for (const testCase of testCases) {
        const result = rectContainsPoint(testCase.rect, testCase.point);
        Assert.equal(result, testCase.contained, { message: JSON.stringify(testCase) });
    }
});
tests.register("Clients.canTileEver", 1, () => {
    const testCases = [
        { clientProperties: { resourceClass: "app", caption: "Title" }, tileable: true },
        { clientProperties: { resourceClass: "app", caption: "Title", moveable: false }, tileable: false },
        { clientProperties: { resourceClass: "app", caption: "Caption", resizeable: false }, tileable: false },
        { clientProperties: { resourceClass: "app", caption: "Caption", normalWindow: false, popupWindow: true }, tileable: false },
        { clientProperties: { resourceClass: "app", caption: "Caption", moveable: false, resizeable: false, fullScreen: true }, tileable: true },
        { clientProperties: { resourceClass: "ksmserver-logout-greeter", caption: "Caption" }, tileable: false },
        { clientProperties: { resourceClass: "xwaylandvideobridge", caption: "" }, tileable: false },
    ];
    for (const testCase of testCases) {
        const kwinClient = createKwinClient(testCase.clientProperties);
        Assert.assert(Clients.canTileEver(kwinClient) === testCase.tileable, { message: "failed case: " + JSON.stringify(testCase) });
    }
    function createKwinClient(properties) {
        const defaultProperties = {
            normalWindow: true,
            transient: false,
            managed: true,
            pid: 100,
            moveable: true,
            resizeable: true,
            fullScreen: false,
            popupWindow: false,
            minimized: false,
            desktops: [1],
            activities: [1],
        };
        return { ...defaultProperties, ...properties };
    }
});
tests.register("Center focused", 5, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [client0, client1, client2] = workspaceMock.createClientsWithWidths(300, 152, 300);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.hasClient(client0));
        Assert.assert(clientManager.hasClient(client1));
        Assert.assert(clientManager.hasClient(client2));
    });
    Assert.assert(workspaceMock.activeWindow === client2);
    Assert.columnsFillTilingArea([client0, client1, client2]);
    // center client2
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.centered(config, tilingArea, client2);
    Assert.fullyVisible(client1.getActualFrameGeometry());
    Assert.fullyVisible(client2.getActualFrameGeometry());
    // undo center client2
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.columnsFillTilingArea([client0, client1, client2]);
    // center client2
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.centered(config, tilingArea, client2);
    Assert.fullyVisible(client1.getActualFrameGeometry());
    Assert.fullyVisible(client2.getActualFrameGeometry());
    // focus client1 (no scrolling should occur)
    qtMock.fireShortcut("karousel-focus-left");
    Assert.centered(config, tilingArea, client2, { message: "No scrolling should have occured" });
    Assert.fullyVisible(client1.getActualFrameGeometry());
    Assert.fullyVisible(client2.getActualFrameGeometry());
    // center client1
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.columnsFillTilingArea([client0, client1, client2]);
    // undo center client1 (no scrolling should occur, because all clients are already visible and centered)
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.columnsFillTilingArea([client0, client1, client2]);
});
tests.register("Column move to desktop", 10, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    function assertDesktop(desktop, clients) {
        for (const client of clients) {
            Assert.equalArrays(client.desktops, [desktop]);
        }
    }
    const desktop0 = workspaceMock.desktops[0];
    const desktop1 = workspaceMock.desktops[1];
    const [client0, client1a, client1b, client1c, client4, client5, client6] = workspaceMock.createClients(7);
    workspaceMock.activeWindow = client1b;
    qtMock.fireShortcut("karousel-window-move-left");
    workspaceMock.activeWindow = client1c;
    qtMock.fireShortcut("karousel-window-move-left");
    workspaceMock.activeWindow = client1b;
    // W1: 0, [1,*2*,3], 4, 5, 6; W2: -
    assertDesktop(desktop0, [client0, client1a, client1b, client1c, client4, client5, client6]);
    qtMock.fireShortcut("karousel-column-move-to-desktop-2");
    // W1: *0*, 4, 5, 6; W2: [1,*2*,3]
    Assert.equal(workspaceMock.activeWindow, client0);
    assertDesktop(desktop0, [client0, client4, client5, client6]);
    assertDesktop(desktop1, [client1a, client1b, client1c]);
    qtMock.fireShortcut("karousel-column-move-to-previous-desktop"); // no-op
    Assert.equal(workspaceMock.activeWindow, client0);
    assertDesktop(desktop0, [client0, client4, client5, client6]);
    assertDesktop(desktop1, [client1a, client1b, client1c]);
    qtMock.fireShortcut("karousel-column-move-to-next-desktop");
    // W1: *4*, 5, 6; W2: [1,*2*,3], 0
    Assert.equal(workspaceMock.activeWindow, client4);
    assertDesktop(desktop0, [client4, client5, client6]);
    assertDesktop(desktop1, [client1a, client1b, client1c, client0]);
    workspaceMock.currentDesktop = workspaceMock.desktops[1];
    qtMock.fireShortcut("karousel-focus-start");
    Assert.equal(workspaceMock.activeWindow, client1b);
    qtMock.fireShortcut("karousel-column-move-to-next-desktop"); // no-op
    Assert.equal(workspaceMock.activeWindow, client1b);
    assertDesktop(desktop0, [client4, client5, client6]);
    assertDesktop(desktop1, [client1a, client1b, client1c, client0]);
    qtMock.fireShortcut("karousel-column-move-to-previous-desktop");
    // W1: *4*, 5, 6, [1,*2*,3]; W2: *0*
    Assert.equal(workspaceMock.activeWindow, client0);
    assertDesktop(desktop0, [client4, client5, client6, client1a, client1b, client1c]);
    assertDesktop(desktop1, [client0]);
    workspaceMock.currentDesktop = workspaceMock.desktops[0];
    qtMock.fireShortcut("karousel-focus-end");
    qtMock.fireShortcut("karousel-focus-left");
    qtMock.fireShortcut("karousel-focus-left");
    // W1: 4, *5*, 6, [1,2,3]; W2: *0*
    Assert.equal(workspaceMock.activeWindow, client5);
    qtMock.fireShortcut("karousel-tail-move-to-previous-desktop"); // no-op
    assertDesktop(desktop0, [client4, client5, client6, client1a, client1b, client1c]);
    assertDesktop(desktop1, [client0]);
    Assert.equal(workspaceMock.activeWindow, client5);
    qtMock.fireShortcut("karousel-tail-move-to-next-desktop");
    // W1: *4*; W2: *0*, 5, 6, [1,2,3]
    Assert.equal(workspaceMock.activeWindow, client4);
    assertDesktop(desktop0, [client4]);
    assertDesktop(desktop1, [client0, client5, client6, client1a, client1b, client1c]);
});
tests.register("column width constraints on window added", 5, () => {
    // moving a window into a column applies that window's max width to the column
    {
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        const assertOpt = { message: "max width" };
        const clients = workspaceMock.createClientsWithWidths(500, 100);
        clients[1].maxSize = new MockQmlSize(300, 9999);
        workspaceMock.activeWindow = clients[1];
        qtMock.fireShortcut("karousel-window-move-left");
        Assert.equal(clients[0].getActualFrameGeometry().width, 300, assertOpt);
        Assert.equal(clients[1].getActualFrameGeometry().width, 300, assertOpt);
    }
    // moving a window into a column applies that window's min width to the column
    {
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        const assertOpt = { message: "min width" };
        const clients = workspaceMock.createClientsWithWidths(200, 100);
        clients[1].minSize = new MockQmlSize(400, 100);
        workspaceMock.activeWindow = clients[1];
        qtMock.fireShortcut("karousel-window-move-left");
        Assert.equal(clients[0].getActualFrameGeometry().width, 400, assertOpt);
        Assert.equal(clients[1].getActualFrameGeometry().width, 400, assertOpt);
    }
});
tests.register("columns squeeze side", 5, () => {
    const baseTestCases = [
        { widths: [500, 500], blocked: [false, false], possible: true },
        { widths: [500, 768], blocked: [false, false], possible: true },
        { widths: [500, 500], blocked: [false, true], possible: true },
        { widths: [500, 200, 200], blocked: [false, false, false], possible: true },
        { widths: [500, 200, 200], blocked: [false, false, true], possible: true },
        { widths: [500, 200, 200], blocked: [true, false, true], possible: true },
        { widths: [500, 500, 500], blocked: [false, true, true], possible: false },
    ];
    const testCasesLeft = baseTestCases.map((baseTestCase, i) => ({
        ...baseTestCase,
        name: "left " + i,
        action: "karousel-columns-squeeze-left",
        focus: baseTestCase.widths.length - 1,
    }));
    const testCasesRight = baseTestCases.map((baseTestCase, i) => ({
        ...baseTestCase,
        widths: baseTestCase.widths.slice().reverse(),
        blocked: baseTestCase.blocked.slice().reverse(),
        name: "right " + i,
        action: "karousel-columns-squeeze-right",
        focus: 0,
    }));
    const testCases = [...testCasesLeft, ...testCasesRight];
    for (const testCase of testCases) {
        const assertOpt = { message: `Case: ${testCase.name}` };
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        const clients = workspaceMock.createClientsWithWidths(...testCase.widths);
        workspaceMock.activeWindow = clients[testCase.focus];
        for (let i = 0; i < clients.length; i++) {
            if (testCase.blocked[i]) {
                clients[i].minSize = new MockQmlSize(testCase.widths[i], 100);
            }
        }
        if (testCase.possible) {
            qtMock.fireShortcut(testCase.action);
            Assert.columnsFillTilingArea(clients, assertOpt);
            for (let i = 0; i < clients.length; i++) {
                if (testCase.blocked[i]) {
                    Assert.equal(clients[i].getActualFrameGeometry().width, testCase.widths[i], assertOpt);
                }
            }
        }
        const frames = clients.map(client => client.getActualFrameGeometry());
        qtMock.fireShortcut(testCase.action);
        const newFrames = clients.map(client => client.getActualFrameGeometry());
        for (let i = 0; i < clients.length; i++) {
            Assert.equalRects(frames[i], newFrames[i], assertOpt);
        }
    }
});
tests.register("columns squeeze side (just scroll)", 5, () => {
    const baseTestCases = [
        { focus: 0, startVisible: [true, true, false], endVisible: [true, true, false] },
        { focus: 1, startVisible: [false, true, true], endVisible: [true, true, false] },
        { focus: 2, startVisible: [false, true, true], endVisible: [false, true, true] },
    ];
    const testCasesLeft = baseTestCases.map((baseTestCase, i) => ({
        ...baseTestCase,
        name: "left " + i,
        action: "karousel-columns-squeeze-left",
        scrollStart: false,
    }));
    const testCasesRight = baseTestCases.map((baseTestCase, i) => ({
        focus: 2 - baseTestCase.focus,
        startVisible: baseTestCase.startVisible.slice().reverse(),
        endVisible: baseTestCase.endVisible.slice().reverse(),
        name: "right " + i,
        action: "karousel-columns-squeeze-right",
        scrollStart: true,
    }));
    const testCases = [...testCasesLeft, ...testCasesRight];
    for (const testCase of testCases) {
        const assertMsg = `Case: ${testCase.name}`;
        const config = getDefaultConfig();
        const { qtMock, workspaceMock, world } = init(config);
        function assertVisible(clients, visible) {
            for (let i = 0; i < clients.length; i++) {
                if (visible[i]) {
                    Assert.fullyVisible(clients[i].getActualFrameGeometry(), { message: assertMsg, skip: 1 });
                }
                else {
                    Assert.notFullyVisible(clients[i].getActualFrameGeometry(), { message: assertMsg, skip: 1 });
                }
            }
        }
        const clients = workspaceMock.createClientsWithWidths(300, 300, 300);
        for (const client of clients) {
            client.minSize = new MockQmlSize(300, 100);
        }
        if (testCase.scrollStart) {
            qtMock.fireShortcut("karousel-grid-scroll-start");
        }
        workspaceMock.activeWindow = clients[testCase.focus];
        assertVisible(clients, testCase.startVisible);
        qtMock.fireShortcut(testCase.action);
        assertVisible(clients, testCase.endVisible);
        const frames = clients.map(client => client.getActualFrameGeometry());
        qtMock.fireShortcut(testCase.action);
        const newFrames = clients.map(client => client.getActualFrameGeometry());
        for (let i = 0; i < clients.length; i++) {
            Assert.equalRects(frames[i], newFrames[i], { message: assertMsg });
        }
    }
});
tests.register("Cursor follows focus", 10, () => {
    const config = getDefaultConfig();
    config.cursorFollowsFocus = true;
    const { qtMock, workspaceMock, world } = init(config);
    const [client1, client2] = workspaceMock.createClients(2);
    const initialCursorPos = new MockQmlPoint(380, 20);
    Assert.assert(rectContainsPoint(client1.getActualFrameGeometry(), initialCursorPos), { message: "invalid test setup" });
    workspaceMock.cursorPos = initialCursorPos.clone();
    runOneOf(() => { Workspace.activeWindow = client1; }, () => { qtMock.fireShortcut("karousel-focus-1"); });
    Assert.assert(rectContainsPoint(client1.getActualFrameGeometry(), Workspace.cursorPos));
    Assert.assert(!rectContainsPoint(client2.getActualFrameGeometry(), Workspace.cursorPos));
    Assert.assert(pointEquals(Workspace.cursorPos, initialCursorPos), { message: "Cursor should not have been moved because it was already within the focused client" });
    runOneOf(() => { Workspace.activeWindow = client2; }, () => { qtMock.fireShortcut("karousel-focus-2"); });
    Assert.assert(!rectContainsPoint(client1.getActualFrameGeometry(), Workspace.cursorPos));
    Assert.assert(rectContainsPoint(client2.getActualFrameGeometry(), Workspace.cursorPos));
    runOneOf(() => { Workspace.activeWindow = client1; }, () => { qtMock.fireShortcut("karousel-focus-1"); });
    Assert.assert(rectContainsPoint(client1.getActualFrameGeometry(), Workspace.cursorPos));
    Assert.assert(!rectContainsPoint(client2.getActualFrameGeometry(), Workspace.cursorPos));
    const lastCursorPos = workspaceMock.cursorPos.clone();
    Workspace.activeWindow = null;
    Assert.assert(pointEquals(Workspace.cursorPos, lastCursorPos), { message: "Cursor should not have been moved" });
});
tests.register("Desktop filtering", 1, () => {
    // Test 1: Default config should work on all desktops
    const config1 = getDefaultConfig();
    const { workspaceMock: wm1, world: world1 } = init(config1);
    const client1 = new MockKwinClient();
    client1.desktops = [wm1.desktops[0]];
    wm1.createWindows(client1);
    world1.do((clientManager) => {
        Assert.tiledClient(clientManager, client1, { message: "Client should be tiled on desktop1 with default config (*)" });
    });
});
tests.register("Desktop filtering - specific desktop", 1, () => {
    // Test 2: Specific desktop name - should work only on matching desktop
    const config2 = getDefaultConfig();
    config2.tiledDesktops = "^Desktop 1$";
    const { workspaceMock: wm2, world: world2 } = init(config2);
    const client1 = new MockKwinClient();
    client1.desktops = [wm2.desktops[0]]; // Desktop 1
    wm2.createWindows(client1);
    world2.do((clientManager) => {
        Assert.tiledClient(clientManager, client1, { message: "Client should be tiled on Desktop 1" });
    });
    wm2.removeWindow(client1);
    const client2 = new MockKwinClient();
    client2.desktops = [wm2.desktops[1]]; // Desktop 2
    wm2.createWindows(client2);
    world2.do((clientManager) => {
        Assert.notTiledClient(clientManager, client2, { message: "Client should NOT be tiled on Desktop 2" });
    });
});
tests.register("Desktop filtering - multiple desktops", 1, () => {
    // Test 3: Multiple desktop names using regex alternation
    const config3 = getDefaultConfig();
    config3.tiledDesktops = "^Desktop [12]$";
    const { workspaceMock: wm3, world: world3 } = init(config3);
    const client1 = new MockKwinClient();
    client1.desktops = [wm3.desktops[0]]; // Desktop 1
    wm3.createWindows(client1);
    world3.do((clientManager) => {
        Assert.tiledClient(clientManager, client1, { message: "Client should be tiled on Desktop 1" });
    });
    wm3.removeWindow(client1);
    const client2 = new MockKwinClient();
    client2.desktops = [wm3.desktops[1]]; // Desktop 2
    wm3.createWindows(client2);
    world3.do((clientManager) => {
        Assert.tiledClient(clientManager, client2, { message: "Client should be tiled on Desktop 2" });
    });
});
tests.register("Desktop filtering - windows on multiple desktops", 1, () => {
    // Test 4: Windows on multiple desktops should not be tiled (fallback to floating)
    const config4 = getDefaultConfig();
    config4.tiledDesktops = ".*";
    const { workspaceMock: wm4, world: world4 } = init(config4);
    const client1 = new MockKwinClient();
    client1.desktops = [wm4.desktops[0], wm4.desktops[1]]; // Multiple desktops
    wm4.createWindows(client1);
    world4.do((clientManager) => {
        Assert.notTiledClient(clientManager, client1, { message: "Client on multiple desktops should not be tiled" });
    });
});
tests.register("Destroy", 5, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [client0, client1, client2] = workspaceMock.createClientsWithWidths(600, 600, 600);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.hasClient(client0));
        Assert.assert(clientManager.hasClient(client1));
        Assert.assert(clientManager.hasClient(client2));
    });
    workspaceMock.activeWindow = client1;
    Assert.notFullyVisible(client0.getActualFrameGeometry());
    Assert.fullyVisible(client1.getActualFrameGeometry());
    Assert.notFullyVisible(client2.getActualFrameGeometry());
    // client0 is expected to move onto the screen (left edge)
    const expectedFrame0 = client1.getActualFrameGeometry().clone();
    expectedFrame0.x = 0;
    // client1 is expected to stay put
    const expectedFrame1 = client1.getActualFrameGeometry().clone();
    // client2 is expected to move onto the screen (right edge)
    const expectedFrame2 = client2.getActualFrameGeometry().clone();
    expectedFrame2.x = screen.width - expectedFrame2.width;
    world.destroy();
    Assert.equalRects(client0.getActualFrameGeometry(), expectedFrame0);
    Assert.equalRects(client1.getActualFrameGeometry(), expectedFrame1);
    Assert.equalRects(client2.getActualFrameGeometry(), expectedFrame2);
});
tests.register("Drag tiled window, untile", 20, () => {
    const config = getDefaultConfig();
    config.untileOnDrag = true;
    const { qtMock, workspaceMock, world } = init(config);
    const clientManager = getClientManager(world);
    const [client0, client1] = workspaceMock.createClients(2);
    Assert.tiledClient(clientManager, client0);
    Assert.tiledClient(clientManager, client1);
    Assert.grid(config, tilingArea, 100, [[client0], [client1]], true);
    workspaceMock.moveWindow(client0, new MockQmlPoint(10, 10));
    Assert.notTiledClient(clientManager, client0);
    Assert.tiledClient(clientManager, client1);
    Assert.grid(config, tilingArea, 100, [[client1]], true);
});
tests.register("Drag tiled window, keep tiled", 20, () => {
    const config = getDefaultConfig();
    config.untileOnDrag = false;
    const { qtMock, workspaceMock, world } = init(config);
    const clientManager = getClientManager(world);
    const [client0, client1] = workspaceMock.createClients(2);
    Assert.tiledClient(clientManager, client0);
    Assert.tiledClient(clientManager, client1);
    Assert.grid(config, tilingArea, 100, [[client0], [client1]], true);
    const move = new MockQmlPoint(10, 10);
    workspaceMock.moveWindow(client0, move, move, move, move, move, move, move, move, move); // many moves in order to trigger externalFrameGeometryChangedRateLimiter
    Assert.tiledClient(clientManager, client0);
    Assert.tiledClient(clientManager, client1);
    Assert.grid(config, tilingArea, 100, [[client0], [client1]], true);
});
tests.register("External resize", 1, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    function getClientDesiredFrame(width) {
        return new MockQmlRect(10, 10, width, 200);
    }
    function getTiledFrame(width) {
        return new MockQmlRect(tilingArea.x + Math.round((tilingArea.width - width) / 2), tilingArea.y, width, tilingArea.height);
    }
    const [client] = workspaceMock.createClientsWithFrames(getClientDesiredFrame(100));
    Assert.equalRects(client.getActualFrameGeometry(), getTiledFrame(100), { message: "We should tile the window, respecting its desired width" });
    function testExternalResizing() {
        client.frameGeometry = getClientDesiredFrame(110);
        Assert.equalRects(client.getActualFrameGeometry(), getTiledFrame(110), { message: "We should re-arrange the window, respecting its new desired width" });
        client.frameGeometry = getClientDesiredFrame(120);
        Assert.equalRects(client.getActualFrameGeometry(), getTiledFrame(120), { message: "We should re-arrange the window, respecting its new desired width" });
        client.frameGeometry = getClientDesiredFrame(130);
        Assert.equalRects(client.getActualFrameGeometry(), getTiledFrame(130), { message: "We should re-arrange the window, respecting its new desired width" });
        client.frameGeometry = getClientDesiredFrame(140);
        Assert.equalRects(client.getActualFrameGeometry(), getTiledFrame(140), { message: "We should re-arrange the window, respecting its new desired width" });
        client.frameGeometry = getClientDesiredFrame(200);
        Assert.equalRects(client.getActualFrameGeometry(), getClientDesiredFrame(200), { message: "We should give up and let the client have its desired frame" });
    }
    timeControl(addTime => {
        testExternalResizing();
        addTime(1000);
        // the concession has expired, let's test again
        testExternalResizing();
    });
});
tests.register("Move and follow window to desktop", 20, () => {
    // This tests the Kwin shortcuts for moving windows to adjacent desktops.
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [client0, client1] = workspaceMock.createClients(2);
    client1.moveAndFollowToDesktop(workspaceMock.desktops[1], workspaceMock);
    Assert.equal(workspaceMock.activeWindow, client1);
});
tests.register("tiledKeepBelow", 10, () => {
    const config = getDefaultConfig();
    config.tiledKeepBelow = true;
    config.floatingKeepAbove = false;
    config.preventUntile = false;
    const { qtMock, workspaceMock, world } = init(config);
    const pinGeometry = new MockQmlRect(0, 0, 200, screen.height);
    const [client] = workspaceMock.createClients(1);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(client.keepBelow);
    Assert.assert(!client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    client.pin(pinGeometry);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    client.unpin();
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(client.keepBelow);
    Assert.assert(!client.keepAbove);
    client.pin(pinGeometry);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(client.keepBelow);
    Assert.assert(!client.keepAbove);
});
tests.register("floatingKeepAbove", 10, () => {
    const config = getDefaultConfig();
    config.tiledKeepBelow = false;
    config.floatingKeepAbove = true;
    config.preventUntile = false;
    const { qtMock, workspaceMock, world } = init(config);
    const pinGeometry = new MockQmlRect(0, 0, 200, screen.height);
    const [client] = workspaceMock.createClients(1);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(client.keepAbove);
    client.pin(pinGeometry);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(client.keepAbove);
    client.unpin();
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
    client.pin(pinGeometry);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) === null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(client.keepAbove);
    qtMock.fireShortcut("karousel-window-toggle-floating");
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.findTiledWindow(client) !== null);
    });
    Assert.assert(!client.keepBelow);
    Assert.assert(!client.keepAbove);
});
tests.register("No layering", 10, () => {
    const config = getDefaultConfig();
    config.tiledKeepBelow = false;
    config.floatingKeepAbove = false;
    config.preventUntile = false;
    // In this mode, Karousel shouldn't change keepBelow or keepAbove.
    // Except when tiling a window, keepAbove should still be cleared.
    const pinGeometry = new MockQmlRect(0, 0, 200, screen.height);
    const testCases = [
        { keepBelow: false, keepAbove: false },
        { keepBelow: false, keepAbove: true },
        { keepBelow: true, keepAbove: false },
        { keepBelow: true, keepAbove: true },
    ];
    for (const testCase of testCases) {
        const assertOptions = { message: JSON.stringify(testCase) };
        const { qtMock, workspaceMock, world } = init(config);
        const [client] = workspaceMock.createClients(1);
        client.keepBelow = testCase.keepBelow;
        client.keepAbove = testCase.keepAbove;
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) !== null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.equal(client.keepAbove, testCase.keepAbove, assertOptions);
        qtMock.fireShortcut("karousel-window-toggle-floating");
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) === null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.equal(client.keepAbove, testCase.keepAbove, assertOptions);
        client.pin(pinGeometry);
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) === null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.equal(client.keepAbove, testCase.keepAbove, assertOptions);
        client.unpin();
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) === null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.equal(client.keepAbove, testCase.keepAbove, assertOptions);
        qtMock.fireShortcut("karousel-window-toggle-floating");
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) !== null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.assert(!client.keepAbove, assertOptions);
        client.keepAbove = testCase.keepAbove;
        client.pin(pinGeometry);
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) === null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.equal(client.keepAbove, testCase.keepAbove, assertOptions);
        qtMock.fireShortcut("karousel-window-toggle-floating");
        world.do((clientManager, desktopManager) => {
            Assert.assert(clientManager.findTiledWindow(client) !== null, assertOptions);
        });
        Assert.equal(client.keepBelow, testCase.keepBelow, assertOptions);
        Assert.assert(!client.keepAbove, assertOptions);
    }
});
tests.register("Focus and move windows", 1, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [client1, client2, client3] = workspaceMock.createClients(3);
    world.do((clientManager, desktopManager) => {
        Assert.assert(clientManager.hasClient(client1));
        Assert.assert(clientManager.hasClient(client2));
        Assert.assert(clientManager.hasClient(client3));
    });
    Assert.assert(workspaceMock.activeWindow === client3);
    function testLayout(shortcutName, grid) {
        qtMock.fireShortcut(shortcutName);
        Assert.grid(config, tilingArea, 100, grid, true, [], { skip: 1 });
    }
    function testFocus(shortcutName, expectedFocus) {
        qtMock.fireShortcut(shortcutName);
        Assert.assert(workspaceMock.activeWindow === expectedFocus, {
            message: `wrong activeWindow: ${workspaceMock.activeWindow?.pid}`,
            skip: 1,
        });
    }
    ;
    testLayout("karousel-column-move-right", [[client1], [client2], [client3]]);
    testLayout("karousel-window-move-left", [[client1], [client2, client3]]);
    testLayout("karousel-window-move-left", [[client1], [client3], [client2]]);
    testLayout("karousel-window-move-left", [[client1, client3], [client2]]);
    testFocus("karousel-focus-right", client2);
    testLayout("karousel-window-move-left", [[client1, client3, client2]]);
    testLayout("karousel-window-move-left", [[client2], [client1, client3]]);
    testLayout("karousel-window-move-left", [[client2], [client1, client3]]);
    testFocus("karousel-focus-2", client3);
    testFocus("karousel-focus-up", client1);
    testLayout("karousel-column-move-left", [[client1, client3], [client2]]);
    testLayout("karousel-window-move-right", [[client3], [client1], [client2]]);
    testFocus("karousel-focus-3", client2);
    testLayout("karousel-window-move-start", [[client2], [client3], [client1]]);
    testLayout("karousel-window-move-to-column-3", [[client3], [client1, client2]]);
    testLayout("karousel-column-move-left", [[client1, client2], [client3]]);
    testLayout("karousel-column-move-end", [[client3], [client1, client2]]);
    testLayout("karousel-column-move-to-column-1", [[client1, client2], [client3]]);
    testLayout("karousel-column-move-right", [[client3], [client1, client2]]);
    testLayout("karousel-window-move-previous", [[client3], [client2, client1]]);
    testLayout("karousel-window-move-previous", [[client3], [client2], [client1]]);
    testLayout("karousel-window-move-previous", [[client3, client2], [client1]]);
    testLayout("karousel-window-move-previous", [[client2, client3], [client1]]);
    testLayout("karousel-window-move-previous", [[client2], [client3], [client1]]);
    testLayout("karousel-window-move-previous", [[client2], [client3], [client1]]);
    testLayout("karousel-window-move-next", [[client2, client3], [client1]]);
    testLayout("karousel-window-move-next", [[client3, client2], [client1]]);
    testLayout("karousel-window-move-next", [[client3], [client2], [client1]]);
    testLayout("karousel-window-move-next", [[client3], [client2, client1]]);
    testLayout("karousel-window-move-next", [[client3], [client1, client2]]);
    testLayout("karousel-window-move-next", [[client3], [client1], [client2]]);
    testLayout("karousel-window-move-next", [[client3], [client1], [client2]]);
    testLayout("karousel-window-move-left", [[client3], [client1, client2]]);
    const col1Win1 = client3;
    const col2Win1 = client1;
    const col2Win2 = client2;
    testFocus("karousel-focus-up", col2Win1);
    testFocus("karousel-focus-up", col2Win1);
    testFocus("karousel-focus-down", col2Win2);
    testFocus("karousel-focus-left", col1Win1);
    testFocus("karousel-focus-left", col1Win1);
    testFocus("karousel-focus-right", col2Win2);
    testFocus("karousel-focus-right", col2Win2);
    testFocus("karousel-focus-2", col2Win2);
    testFocus("karousel-focus-1", col1Win1);
    testFocus("karousel-focus-2", col2Win2);
    testFocus("karousel-focus-start", col1Win1);
    testFocus("karousel-focus-end", col2Win2);
    testFocus("karousel-focus-up", col2Win1);
    testFocus("karousel-focus-left", col1Win1);
    testFocus("karousel-focus-right", col2Win1);
    testFocus("karousel-focus-2", col2Win1);
    testFocus("karousel-focus-1", col1Win1);
    testFocus("karousel-focus-2", col2Win1);
    testFocus("karousel-focus-start", col1Win1);
    testFocus("karousel-focus-end", col2Win1);
    testFocus("karousel-focus-down", col2Win2);
    testFocus("karousel-focus-start", col1Win1);
    testFocus("karousel-focus-next", col2Win1);
    testFocus("karousel-focus-next", col2Win2);
    testFocus("karousel-focus-next", col2Win2);
    testFocus("karousel-focus-previous", col2Win1);
    testFocus("karousel-focus-previous", col1Win1);
    testFocus("karousel-focus-previous", col1Win1);
});
tests.register("LazyScroller", 20, () => {
    const config = getDefaultConfig();
    config.scrollingLazy = true;
    config.scrollingCentered = false;
    config.scrollingGrouped = false;
    const { qtMock, workspaceMock, world } = init(config);
    const [client1] = workspaceMock.createClientsWithWidths(300);
    Assert.grid(config, tilingArea, 300, [[client1]], true);
    const [client2] = workspaceMock.createClientsWithWidths(300);
    Assert.grid(config, tilingArea, 300, [[client1], [client2]], true);
    const [client3] = workspaceMock.createClientsWithWidths(300);
    Assert.grid(config, tilingArea, 300, [[client1], [client2], [client3]], false);
    Assert.equal(rectRight(client3.getActualFrameGeometry()), rectRight(tilingArea));
    runOneOf(() => { workspaceMock.activeWindow = client2; }, () => { qtMock.fireShortcut("karousel-focus-2"); }, () => { qtMock.fireShortcut("karousel-focus-left"); });
    Assert.grid(config, tilingArea, 300, [[client1], [client2], [client3]], false);
    Assert.equal(rectRight(client3.getActualFrameGeometry()), rectRight(tilingArea));
    runOneOf(() => { workspaceMock.activeWindow = client1; }, () => { qtMock.fireShortcut("karousel-focus-1"); }, () => { qtMock.fireShortcut("karousel-focus-left"); }, () => { qtMock.fireShortcut("karousel-focus-start"); });
    workspaceMock.activeWindow = client1;
    Assert.grid(config, tilingArea, 300, [[client1], [client2], [client3]], false);
    Assert.equal(client1.getActualFrameGeometry().x, tilingArea.x);
    qtMock.fireShortcut("karousel-grid-scroll-focused");
    Assert.grid(config, tilingArea, 300, [[client1], [client2], [client3]], false);
    Assert.grid(config, tilingArea, 300, [[client1]], true);
    runOneOf(() => { workspaceMock.activeWindow = client2; }, () => { qtMock.fireShortcut("karousel-focus-2"); }, () => { qtMock.fireShortcut("karousel-focus-right"); });
    Assert.grid(config, tilingArea, 300, [[client1], [client2], [client3]], false);
    Assert.equal(client1.getActualFrameGeometry().x, tilingArea.x);
});
{
    function registerTests(suffix, getConfig, shouldKeepBelow, shouldKeepAbove) {
        tests.register("Maximization " + suffix, 100, () => {
            const config = getConfig();
            const { qtMock, workspaceMock, world } = init(config);
            const [kwinClient] = workspaceMock.createClientsWithWidths(300);
            world.do((clientManager, desktopManager) => {
                Assert.assert(clientManager.hasClient(kwinClient));
            });
            const columnLeftX = tilingArea.x + tilingArea.width / 2 - 300 / 2;
            const columnTopY = tilingArea.y;
            const columnHeight = tilingArea.height;
            Assert.assert(!kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(true));
            Assert.rect(kwinClient.getActualFrameGeometry(), columnLeftX, columnTopY, 300, columnHeight);
            kwinClient.fullScreen = true;
            Assert.assert(kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(false));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(kwinClient.getActualFrameGeometry(), screen);
            kwinClient.fullScreen = false;
            Assert.assert(!kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(true));
            Assert.rect(kwinClient.getActualFrameGeometry(), columnLeftX, columnTopY, 300, columnHeight);
            kwinClient.setMaximize(true, true);
            Assert.assert(!kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(false));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(kwinClient.getActualFrameGeometry(), screen);
            kwinClient.setMaximize(true, false);
            Assert.assert(!kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(false));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(false));
            Assert.rect(kwinClient.getActualFrameGeometry(), columnLeftX, 0, 300, screen.height);
            kwinClient.setMaximize(false, false);
            Assert.assert(!kwinClient.fullScreen);
            Assert.equal(kwinClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(kwinClient.keepAbove, shouldKeepAbove(true));
            Assert.rect(kwinClient.getActualFrameGeometry(), columnLeftX, columnTopY, 300, columnHeight);
        });
        tests.register("Maximize with transient " + suffix, 100, () => {
            const config = getConfig();
            const { qtMock, workspaceMock, world } = init(config);
            const parent = new MockKwinClient(new MockQmlRect(10, 20, 300, 200));
            const child = new MockKwinClient(new MockQmlRect(14, 24, 50, 50), parent);
            workspaceMock.createWindows(parent);
            world.do((clientManager, desktopManager) => {
                Assert.assert(clientManager.hasClient(parent));
            });
            runOneOf(() => { parent.fullScreen = true; }, () => { parent.setMaximize(true, true); });
            Assert.equal(parent.keepBelow, shouldKeepBelow(false));
            Assert.equal(parent.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(parent.getActualFrameGeometry(), screen);
            workspaceMock.createWindows(child);
            world.do((clientManager, desktopManager) => {
                Assert.assert(clientManager.hasClient(child));
            });
            Assert.assert(!child.fullScreen);
            Assert.equal(child.keepBelow, shouldKeepBelow(false));
            Assert.equal(child.keepAbove, shouldKeepAbove(false));
            Assert.rect(child.getActualFrameGeometry(), 14, 24, 50, 50);
            Assert.equal(parent.keepBelow, shouldKeepBelow(false));
            Assert.equal(parent.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(parent.getActualFrameGeometry(), screen);
        });
        {
            function assertWindowed(config, clients) {
                Assert.assert(!clients[0].fullScreen);
                Assert.equal(clients[0].keepBelow, shouldKeepBelow(true));
                Assert.equal(clients[0].keepAbove, shouldKeepAbove(true));
                Assert.assert(!clients[1].fullScreen);
                Assert.equal(clients[1].keepBelow, shouldKeepBelow(true));
                Assert.equal(clients[1].keepAbove, shouldKeepAbove(true));
                Assert.assert(!clients[2].fullScreen);
                Assert.equal(clients[2].keepBelow, shouldKeepBelow(true));
                Assert.equal(clients[2].keepAbove, shouldKeepAbove(true));
                Assert.grid(config, tilingArea, [300, 400], [[clients[0]], [clients[1], clients[2]]], true);
            }
            function assertFullScreenOrMaximized(clients) {
                Assert.assert(!clients[0].fullScreen);
                Assert.equal(clients[0].keepBelow, shouldKeepBelow(true));
                Assert.equal(clients[0].keepAbove, shouldKeepAbove(true));
                Assert.assert(!clients[1].fullScreen);
                Assert.equal(clients[1].keepBelow, shouldKeepBelow(true));
                Assert.equal(clients[1].keepAbove, shouldKeepAbove(true));
                Assert.equal(clients[2].keepBelow, shouldKeepBelow(false));
                Assert.equal(clients[2].keepAbove, shouldKeepAbove(false));
                Assert.equalRects(clients[2].getActualFrameGeometry(), screen);
            }
            tests.register("Re-maximize disabled " + suffix, 100, () => {
                const config = getConfig();
                config.reMaximize = false;
                const { qtMock, workspaceMock, world } = init(config);
                const clients = workspaceMock.createClientsWithWidths(300, 400, 400);
                qtMock.fireShortcut("karousel-window-move-left");
                assertWindowed(config, clients);
                runOneOf(() => { clients[2].fullScreen = true; }, () => { clients[2].setMaximize(true, true); });
                assertFullScreenOrMaximized(clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[0]; }, () => { qtMock.fireShortcut("karousel-focus-1"); }, () => { qtMock.fireShortcut("karousel-focus-left"); }, () => { qtMock.fireShortcut("karousel-focus-start"); });
                assertWindowed(config, clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[2]; }, () => { qtMock.fireShortcut("karousel-focus-2"); }, () => { qtMock.fireShortcut("karousel-focus-right"); }, () => { qtMock.fireShortcut("karousel-focus-end"); });
                assertWindowed(config, clients);
                runOneOf(() => { clients[2].fullScreen = true; }, () => { clients[2].setMaximize(true, true); });
                assertFullScreenOrMaximized(clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[1]; }, () => { qtMock.fireShortcut("karousel-focus-up"); });
                assertWindowed(config, clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[2]; }, () => { qtMock.fireShortcut("karousel-focus-down"); });
                assertWindowed(config, clients);
            });
            tests.register("Re-maximize enabled " + suffix, 100, () => {
                const config = getConfig();
                config.reMaximize = true;
                const { qtMock, workspaceMock, world } = init(config);
                const clients = workspaceMock.createClientsWithWidths(300, 400, 400);
                qtMock.fireShortcut("karousel-window-move-left");
                assertWindowed(config, clients);
                runOneOf(() => { clients[2].fullScreen = true; }, () => { clients[2].setMaximize(true, true); });
                assertFullScreenOrMaximized(clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[0]; }, () => { qtMock.fireShortcut("karousel-focus-1"); }, () => { qtMock.fireShortcut("karousel-focus-left"); }, () => { qtMock.fireShortcut("karousel-focus-start"); });
                assertWindowed(config, clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[2]; }, () => { qtMock.fireShortcut("karousel-focus-2"); }, () => { qtMock.fireShortcut("karousel-focus-right"); }, () => { qtMock.fireShortcut("karousel-focus-end"); });
                assertFullScreenOrMaximized(clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[1]; }, () => { qtMock.fireShortcut("karousel-focus-up"); });
                assertWindowed(config, clients);
                runOneOf(() => { workspaceMock.activeWindow = clients[2]; }, () => { qtMock.fireShortcut("karousel-focus-down"); });
                assertFullScreenOrMaximized(clients);
            });
        }
        tests.register("Start full-screen " + suffix, 100, () => {
            const config = getConfig();
            config.reMaximize = true;
            const { qtMock, workspaceMock, world } = init(config);
            const [windowedClient] = workspaceMock.createClientsWithWidths(300);
            const fullScreenClient = new MockKwinClient(new MockQmlRect(0, 0, 400, 200));
            fullScreenClient.resourceClass = "full-screen-app";
            fullScreenClient.fullScreen = true;
            workspaceMock.createWindows(fullScreenClient);
            world.do((clientManager, desktopManager) => {
                Assert.assert(clientManager.hasClient(windowedClient));
                Assert.assert(clientManager.hasClient(fullScreenClient));
            });
            Assert.assert(!windowedClient.fullScreen);
            Assert.equal(windowedClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(windowedClient.keepAbove, shouldKeepAbove(true));
            Assert.centered(config, tilingArea, windowedClient);
            Assert.assert(fullScreenClient.fullScreen);
            Assert.equal(fullScreenClient.keepBelow, shouldKeepBelow(false));
            Assert.equal(fullScreenClient.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(fullScreenClient.getActualFrameGeometry(), screen);
            Assert.equal(Workspace.activeWindow, fullScreenClient);
            {
                qtMock.fireShortcut("karousel-focus-left");
                const opts = { message: "fullScreenClient is not in the grid, so we can't move focus directionally" };
                Assert.assert(!windowedClient.fullScreen);
                Assert.equal(windowedClient.keepBelow, shouldKeepBelow(true));
                Assert.equal(windowedClient.keepAbove, shouldKeepAbove(true));
                Assert.centered(config, tilingArea, windowedClient);
                Assert.assert(fullScreenClient.fullScreen);
                Assert.equal(fullScreenClient.keepBelow, shouldKeepBelow(false));
                Assert.equal(fullScreenClient.keepAbove, shouldKeepAbove(false));
                Assert.equalRects(fullScreenClient.getActualFrameGeometry(), screen);
                Assert.equal(Workspace.activeWindow, fullScreenClient, opts);
            }
            {
                qtMock.fireShortcut("karousel-focus-1");
                const opts = { message: "fullScreenClient is not in grid, so it should stay full-screen" };
                Assert.assert(!windowedClient.fullScreen);
                Assert.equal(windowedClient.keepBelow, shouldKeepBelow(true));
                Assert.equal(windowedClient.keepAbove, shouldKeepAbove(true));
                Assert.centered(config, tilingArea, windowedClient);
                Assert.assert(fullScreenClient.fullScreen);
                Assert.equal(fullScreenClient.keepBelow, shouldKeepBelow(false));
                Assert.equal(fullScreenClient.keepAbove, shouldKeepAbove(false));
                Assert.equalRects(fullScreenClient.getActualFrameGeometry(), screen);
                Assert.equal(Workspace.activeWindow, windowedClient);
            }
        });
        tests.register("Start full-screen (force tiling) " + suffix, 100, () => {
            const config = getConfig();
            config.reMaximize = true;
            config.windowRules = '[{ "class": "full-screen-app", "tile": true }]';
            const { qtMock, workspaceMock, world } = init(config);
            const column1Width = 300;
            const [windowedClient] = workspaceMock.createClientsWithWidths(column1Width);
            const fullScreenClient = new MockKwinClient(new MockQmlRect(0, 0, 400, 200));
            fullScreenClient.resourceClass = "full-screen-app";
            fullScreenClient.fullScreen = true;
            workspaceMock.createWindows(fullScreenClient);
            world.do((clientManager, desktopManager) => {
                Assert.assert(clientManager.hasClient(windowedClient));
                Assert.assert(clientManager.hasClient(fullScreenClient));
            });
            Assert.assert(!windowedClient.fullScreen);
            Assert.equal(windowedClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(windowedClient.keepAbove, shouldKeepAbove(true));
            Assert.grid(config, tilingArea, [column1Width], [[windowedClient]], false);
            Assert.assert(fullScreenClient.fullScreen);
            Assert.equal(fullScreenClient.keepBelow, shouldKeepBelow(false));
            Assert.equal(fullScreenClient.keepAbove, shouldKeepAbove(false));
            Assert.equalRects(fullScreenClient.getActualFrameGeometry(), screen);
            Assert.equal(Workspace.activeWindow, fullScreenClient);
            let expectedColumn2Width = 0;
            let expectedActiveWindow;
            runOneOf(() => {
                fullScreenClient.fullScreen = false;
                expectedColumn2Width = 400;
                expectedActiveWindow = fullScreenClient;
            }, () => {
                qtMock.fireShortcut("karousel-focus-left");
                expectedColumn2Width = tilingArea.width;
                expectedActiveWindow = windowedClient;
            });
            const opts = { message: "fullScreenClient should be restored from full-screen mode to tiled mode" };
            Assert.assert(!windowedClient.fullScreen);
            Assert.equal(windowedClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(windowedClient.keepAbove, shouldKeepAbove(true));
            Assert.assert(!fullScreenClient.fullScreen);
            Assert.equal(fullScreenClient.keepBelow, shouldKeepBelow(true));
            Assert.equal(fullScreenClient.keepAbove, shouldKeepAbove(true));
            Assert.grid(config, tilingArea, [column1Width, expectedColumn2Width], [[windowedClient], [fullScreenClient]], false, [], opts);
            Assert.equal(Workspace.activeWindow, expectedActiveWindow);
        });
    }
    function getConfig(floatingKeepAbove) {
        const config = getDefaultConfig();
        config.tiledKeepBelow = !floatingKeepAbove;
        config.floatingKeepAbove = floatingKeepAbove;
        return config;
    }
    registerTests("(tiled below)", getConfig.partial(false), tiled => tiled, tiled => false);
    registerTests("(floating above)", getConfig.partial(true), tiled => false, tiled => !tiled);
}
tests.register("Pass focus", 100, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [client0, client1a, client1b, client1c, client4, client5, client6] = workspaceMock.createClients(7);
    workspaceMock.activeWindow = client1b;
    qtMock.fireShortcut("karousel-window-move-left");
    workspaceMock.activeWindow = client1c;
    qtMock.fireShortcut("karousel-window-move-left");
    workspaceMock.activeWindow = client1b;
    workspaceMock.activeWindow = client5;
    function removeWindow(client) {
        runOneOf(() => workspaceMock.removeWindow(client), () => client.desktops = [workspaceMock.desktops[1]]);
    }
    removeWindow(client5);
    Assert.equal(workspaceMock.activeWindow, client4);
    qtMock.fireShortcut("karousel-column-move-to-desktop-2");
    Assert.equal(workspaceMock.activeWindow, client1b);
    removeWindow(client1b);
    Assert.equal(workspaceMock.activeWindow, client1a);
    removeWindow(client1a);
    Assert.equal(workspaceMock.activeWindow, client1c);
    removeWindow(client1c);
    Assert.equal(workspaceMock.activeWindow, client0);
    removeWindow(client0);
    Assert.equal(workspaceMock.activeWindow, client6);
});
tests.register("Pin", 20, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const screenHalfLeft = new MockQmlRect(0, 0, screen.width / 2, screen.height);
    const screenHalfRight = new MockQmlRect(screen.width / 2, 0, screen.width / 2, screen.height);
    const tilingAreaHalfLeft = new MockQmlRect(tilingArea.x, tilingArea.y, screen.width / 2 - config.gapsOuterLeft - config.gapsOuterRight, tilingArea.height);
    const tilingAreaHalfRight = new MockQmlRect(screen.width / 2 + config.gapsOuterLeft, tilingArea.y, screen.width / 2 - config.gapsOuterLeft - config.gapsOuterRight, tilingArea.height);
    const [pinned, tiled1, tiled2] = workspaceMock.createClients(3);
    Assert.grid(config, tilingArea, 100, [[pinned], [tiled1], [tiled2]], true);
    pinned.pin(screenHalfLeft);
    Assert.equalRects(pinned.getActualFrameGeometry(), screenHalfLeft);
    Assert.grid(config, tilingAreaHalfRight, 100, [[tiled1], [tiled2]], true);
    pinned.pin(screenHalfRight);
    Assert.equalRects(pinned.getActualFrameGeometry(), screenHalfRight);
    Assert.grid(config, tilingAreaHalfLeft, 100, [[tiled1], [tiled2]], true);
    pinned.unpin();
    Assert.equalRects(pinned.getActualFrameGeometry(), screenHalfRight);
    Assert.grid(config, tilingArea, 100, [[tiled1], [tiled2]], true);
    pinned.pin(screenHalfRight);
    Assert.equalRects(pinned.getActualFrameGeometry(), screenHalfRight);
    Assert.grid(config, tilingAreaHalfLeft, 100, [[tiled1], [tiled2]], true);
    pinned.minimized = true;
    Assert.grid(config, tilingArea, 100, [[tiled1], [tiled2]], true);
    pinned.minimized = false;
    Assert.equalRects(pinned.getActualFrameGeometry(), screenHalfRight);
    Assert.grid(config, tilingAreaHalfLeft, 100, [[tiled1], [tiled2]], true);
    workspaceMock.activeWindow = pinned;
    qtMock.fireShortcut("karousel-window-toggle-floating");
    Assert.assert(pinned.tile === null);
    pinned.frameGeometry = new MockQmlRect(10, 20, 100, 200); // This is needed because the window's preferredWidth can change when pinning, because frameGeometryChanged can fire before tileChanged. TODO: Ensure pinned window keeps its preferredWidth.
    Assert.grid(config, tilingArea, 100, [[tiled1], [tiled2], [pinned]], true);
});
tests.register("Preset Widths default", 5, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const maxWidth = tilingArea.width;
    const halfWidth = maxWidth / 2 - config.gapsInnerHorizontal / 2;
    function getRect(columnWidth) {
        return new MockQmlRect(tilingArea.x + (tilingArea.width - columnWidth) / 2, tilingArea.y, columnWidth, tilingArea.height);
    }
    const [kwinClient] = workspaceMock.createClientsWithWidths(300);
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(300));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(halfWidth));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(maxWidth));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(halfWidth));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(maxWidth));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(halfWidth));
});
tests.register("Preset Widths custom", 5, () => {
    const config = getDefaultConfig();
    config.presetWidths = "500px, 250px, 100px, 50%";
    const { qtMock, workspaceMock, world } = init(config);
    const maxWidth = tilingArea.width;
    const halfWidth = maxWidth / 2 - config.gapsInnerHorizontal / 2;
    function getRect(columnWidth) {
        return new MockQmlRect(tilingArea.x + (tilingArea.width - columnWidth) / 2, tilingArea.y, columnWidth, tilingArea.height);
    }
    const [kwinClient] = workspaceMock.createClientsWithWidths(200);
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(200));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(250));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(halfWidth));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(500));
    qtMock.fireShortcut("karousel-cycle-preset-widths");
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(100));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(250));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths-reverse"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(100));
    qtMock.fireShortcut("karousel-cycle-preset-widths-reverse");
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(500));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths-reverse"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(halfWidth));
});
tests.register("Preset Widths custom percentages", 5, () => {
    const config = getDefaultConfig();
    config.presetWidths = "25%, 50%, 75%, 100%";
    const { qtMock, workspaceMock, world } = init(config);
    const width100 = tilingArea.width;
    const width75 = width100 * 0.75 - config.gapsInnerHorizontal * 0.25;
    const width50 = width100 * 0.50 - config.gapsInnerHorizontal * 0.50;
    const width25 = width100 * 0.25 - config.gapsInnerHorizontal * 0.75;
    function getRect(columnWidth) {
        return new MockQmlRect(tilingArea.x + (tilingArea.width - columnWidth) / 2, tilingArea.y, columnWidth, tilingArea.height);
    }
    const [kwinClient] = workspaceMock.createClientsWithWidths(200);
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(200));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width50));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width75));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths"), () => qtMock.fireShortcut("karousel-column-width-increase"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width100));
    qtMock.fireShortcut("karousel-cycle-preset-widths");
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width25));
    qtMock.fireShortcut("karousel-cycle-preset-widths-reverse");
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width100));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths-reverse"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width75));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths-reverse"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width50));
    runOneOf(() => qtMock.fireShortcut("karousel-cycle-preset-widths-reverse"), () => qtMock.fireShortcut("karousel-column-width-decrease"));
    Assert.equalRects(kwinClient.getActualFrameGeometry(), getRect(width25));
});
tests.register("Preset Widths fill screen uniform", 1, () => {
    for (let nColumns = 1; nColumns < 10; nColumns++) {
        const config = getDefaultConfig();
        config.presetWidths = String(1 / nColumns);
        const { qtMock, workspaceMock, world } = init(config);
        let firstClient, lastClient;
        for (let i = 0; i < nColumns; i++) {
            const [kwinClient] = workspaceMock.createClientsWithWidths(300);
            if (i === 0) {
                firstClient = kwinClient;
            }
            if (i === nColumns - 1) {
                lastClient = kwinClient;
            }
            qtMock.fireShortcut("karousel-cycle-preset-widths");
        }
        const left = tilingArea.x;
        const right = rectRight(tilingArea);
        const maxLeftoverPx = nColumns - 1;
        const eps = Math.ceil(maxLeftoverPx / 2);
        Assert.between(firstClient.getActualFrameGeometry().x, left, left + eps, { message: `nColumns: ${nColumns}` });
        Assert.between(rectRight(lastClient.getActualFrameGeometry()), right - eps, right, { message: `nColumns: ${nColumns}` });
    }
});
tests.register("Preset Widths fill screen non-uniform", 1, () => {
    const config = getDefaultConfig();
    config.presetWidths = String("50%, 25%");
    const { qtMock, workspaceMock, world } = init(config);
    const [clientThin1] = workspaceMock.createClientsWithWidths(100);
    qtMock.fireShortcut("karousel-cycle-preset-widths");
    const [clientThin2] = workspaceMock.createClientsWithWidths(100);
    qtMock.fireShortcut("karousel-cycle-preset-widths");
    const [clientWide] = workspaceMock.createClientsWithWidths(300);
    qtMock.fireShortcut("karousel-cycle-preset-widths");
    const maxWidth = tilingArea.width;
    const halfWidth = maxWidth / 2 - config.gapsInnerHorizontal / 2;
    const quarterWidth = halfWidth / 2 - config.gapsInnerHorizontal / 2;
    const height = tilingArea.height;
    const left1 = tilingArea.x;
    const left2 = left1 + config.gapsInnerHorizontal + quarterWidth;
    const left3 = left2 + config.gapsInnerHorizontal + quarterWidth;
    Assert.rect(clientThin1.getActualFrameGeometry(), left1, tilingArea.y, quarterWidth, height);
    Assert.rect(clientThin2.getActualFrameGeometry(), left2, tilingArea.y, quarterWidth, height);
    Assert.rect(clientWide.getActualFrameGeometry(), left3, tilingArea.y, halfWidth, height);
    Assert.equal(rectRight(clientWide.getActualFrameGeometry()), rectRight(tilingArea));
});
tests.register("Stacked", 5, () => {
    const config = getDefaultConfig();
    const { qtMock, workspaceMock, world } = init(config);
    const [leftTop, leftBottom, rightTop, rightBottom] = workspaceMock.createClients(4);
    const grid = [[leftTop, leftBottom], [rightTop, rightBottom]];
    workspaceMock.activeWindow = rightBottom;
    qtMock.fireShortcut("karousel-window-move-left");
    workspaceMock.activeWindow = leftBottom;
    qtMock.fireShortcut("karousel-window-move-left");
    Assert.grid(config, tilingArea, 100, grid, true);
    qtMock.fireShortcut("karousel-column-toggle-stacked");
    Assert.grid(config, tilingArea, 100, grid, true, [0]);
    qtMock.fireShortcut("karousel-focus-up");
    Assert.grid(config, tilingArea, 100, grid, true, [0]);
    qtMock.fireShortcut("karousel-focus-down");
    Assert.grid(config, tilingArea, 100, grid, true, [0]);
    qtMock.fireShortcut("karousel-window-move-up");
    Assert.grid(config, tilingArea, 100, [[leftBottom, leftTop], [rightTop, rightBottom]], true, [0]);
    qtMock.fireShortcut("karousel-window-move-down");
    Assert.grid(config, tilingArea, 100, grid, true, [0]);
    qtMock.fireShortcut("karousel-column-toggle-stacked");
    Assert.grid(config, tilingArea, 100, grid, true);
});
tests.register("User resize", 10, () => {
    const config = getDefaultConfig();
    config.resizeNeighborColumn = true;
    const h = getWindowHeight(2);
    let clientLeft, clientRightTop, clientRightBottom;
    function assertSizes(leftWidth, rightWidth, topHeight, bottomHeight) {
        const { left, right } = getGridBounds(clientLeft, clientRightTop);
        Assert.rect(clientLeft.getActualFrameGeometry(), left, tilingArea.y, leftWidth, tilingArea.height);
        Assert.rect(clientRightTop.getActualFrameGeometry(), left + leftWidth + gapH, tilingArea.y, rightWidth, topHeight);
        Assert.rect(clientRightBottom.getActualFrameGeometry(), left + leftWidth + gapH, tilingArea.y + topHeight + gapV, rightWidth, bottomHeight);
    }
    {
        const { qtMock, workspaceMock, world } = init(config);
        [clientLeft, clientRightTop, clientRightBottom] = workspaceMock.createClientsWithWidths(300, 300, 200);
        qtMock.fireShortcut("karousel-window-move-left");
        assertSizes(300, 300, h, h);
        workspaceMock.resizeWindow(clientLeft, false, false, false, new MockQmlSize(10, 20));
        assertSizes(310, 300, h, h);
        workspaceMock.resizeWindow(clientLeft, true, false, false, new MockQmlSize(10, 0), new MockQmlSize(-10, 0));
        assertSizes(310, 300, h, h);
        workspaceMock.resizeWindow(clientRightTop, false, false, false, new MockQmlSize(-5, -10), new MockQmlSize(-5, -10));
        assertSizes(310, 290, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightBottom, false, false, false, new MockQmlSize(-10, 20));
        assertSizes(310, 280, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightBottom, false, false, true, new MockQmlSize(0, 20));
        assertSizes(310, 280, h - 40, h + 40);
    }
    {
        const { qtMock, workspaceMock, world } = init(config);
        [clientLeft, clientRightTop, clientRightBottom] = workspaceMock.createClientsWithWidths(300, 300, 200);
        qtMock.fireShortcut("karousel-window-move-left");
        assertSizes(300, 300, h, h);
        workspaceMock.resizeWindow(clientLeft, true, false, false, new MockQmlSize(10, 20));
        assertSizes(310, 290, h, h);
        workspaceMock.resizeWindow(clientLeft, true, false, false, new MockQmlSize(10, 0), new MockQmlSize(-10, 0));
        assertSizes(310, 290, h, h);
        workspaceMock.resizeWindow(clientRightTop, true, false, false, new MockQmlSize(-5, -10), new MockQmlSize(-5, -10));
        assertSizes(310, 280, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightBottom, true, true, false, new MockQmlSize(-10, 20));
        assertSizes(320, 270, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightBottom, true, false, true, new MockQmlSize(0, 20));
        assertSizes(320, 270, h - 40, h + 40);
    }
    {
        const { qtMock, workspaceMock, world } = init(config);
        [clientLeft, clientRightTop, clientRightBottom] = workspaceMock.createClientsWithWidths(300, 300, 200);
        clientRightBottom.minSize = new MockQmlSize(295, h - 20);
        qtMock.fireShortcut("karousel-window-move-left");
        assertSizes(300, 300, h, h);
        workspaceMock.resizeWindow(clientLeft, true, false, false, new MockQmlSize(10, 20));
        assertSizes(310, 295, h, h);
        workspaceMock.resizeWindow(clientLeft, true, false, false, new MockQmlSize(10, 0), new MockQmlSize(-10, 0));
        assertSizes(310, 295, h, h);
        workspaceMock.resizeWindow(clientRightTop, true, false, false, new MockQmlSize(-5, -10), new MockQmlSize(-5, -10));
        assertSizes(310, 295, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightBottom, true, true, false, new MockQmlSize(-10, 20));
        assertSizes(310, 295, h - 20, h + 20);
        workspaceMock.resizeWindow(clientRightTop, true, true, false, new MockQmlSize(-10, 0));
        assertSizes(310, 295, h - 20, h + 20);
        // TODO
        // workspaceMock.resizeWindow(clientRightBottom, true, false, true, new MockQmlSize(0, -80));
        // assertSizes(310, 295, h+60, h-20);
    }
    {
        const { qtMock, workspaceMock, world } = init(config);
        const [clientLeftTop, clientLeftBottom, clientRight] = workspaceMock.createClientsWithWidths(300, 200, 300);
        clientLeftBottom.minSize = new MockQmlSize(295, h - 20);
        function assertSizes(leftWidth, rightWidth, topHeight, bottomHeight) {
            const { left, right } = getGridBounds(clientLeftTop, clientRight);
            Assert.rect(clientLeftTop.getActualFrameGeometry(), left, tilingArea.y, leftWidth, topHeight);
            Assert.rect(clientLeftBottom.getActualFrameGeometry(), left, tilingArea.y + topHeight + gapV, leftWidth, bottomHeight);
            Assert.rect(clientRight.getActualFrameGeometry(), left + leftWidth + gapH, tilingArea.y, rightWidth, tilingArea.height);
        }
        workspaceMock.activeWindow = clientLeftBottom;
        qtMock.fireShortcut("karousel-window-move-left");
        assertSizes(300, 300, h, h);
        workspaceMock.resizeWindow(clientLeftTop, true, false, false, new MockQmlSize(-10, 0));
        assertSizes(295, 305, h, h);
        workspaceMock.resizeWindow(clientLeftTop, true, false, false, new MockQmlSize(10, 0));
        assertSizes(305, 295, h, h);
        workspaceMock.resizeWindow(clientLeftTop, true, false, false, new MockQmlSize(-20, 0), new MockQmlSize(20, 0));
        assertSizes(305, 295, h, h);
    }
});
tests.register("Vertical resize", 10, () => {
    const config = getDefaultConfig();
    const stepSize = config.verticalResizeStep;
    const h1 = getWindowHeight(1);
    const h2 = getWindowHeight(2);
    const h3 = getWindowHeight(3);
    let client1, client2, client3;
    // Single window
    {
        const { qtMock, workspaceMock, world } = init(config);
        [client1] = workspaceMock.createClientsWithWidths(300);
        qtMock.fireShortcut("karousel-focus-start");
        const g1 = client1.getActualFrameGeometry();
        Assert.equal(g1.height, h1);
        Assert.equal(g1.width, 300);
        qtMock.fireShortcut("karousel-window-height-increase-up"); // no-op
        const g1n = client1.getActualFrameGeometry();
        Assert.equal(g1, g1n);
    }
    // Two windows
    {
        const { qtMock, workspaceMock, world } = init(config);
        [client1, client2] = workspaceMock.createClientsWithWidths(300, 300);
        qtMock.fireShortcut("karousel-window-move-left");
        // Verify the layout
        {
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            Assert.equal(g1.height, h2);
            Assert.equal(g2.height, h2);
            Assert.equal(g1.width, 300);
            Assert.equal(g2.width, 300);
        }
        // Upper window
        {
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            qtMock.fireShortcut("karousel-focus-up");
            qtMock.fireShortcut("karousel-window-height-increase-up"); // no-op
            const g1n1 = client1.getActualFrameGeometry();
            const g2n1 = client2.getActualFrameGeometry();
            Assert.equal(g1.height, g1n1.height);
            Assert.equal(g2.height, g2n1.height);
            qtMock.fireShortcut("karousel-window-height-increase-down");
            const g1n2 = client1.getActualFrameGeometry();
            const g2n2 = client2.getActualFrameGeometry();
            Assert.equal(g1.height + stepSize, g1n2.height);
            Assert.equal(g2.height - stepSize, g2n2.height);
        }
        // Lower window
        {
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            qtMock.fireShortcut("karousel-focus-down");
            qtMock.fireShortcut("karousel-window-height-increase-down"); // no-op
            const g1n1 = client1.getActualFrameGeometry();
            const g2n1 = client2.getActualFrameGeometry();
            Assert.equal(g1.height, g1n1.height);
            Assert.equal(g2.height, g2n1.height);
            qtMock.fireShortcut("karousel-window-height-increase-up");
            const g1n2 = client1.getActualFrameGeometry();
            const g2n2 = client2.getActualFrameGeometry();
            Assert.equal(g1.height - stepSize, g1n2.height);
            Assert.equal(g2.height + stepSize, g2n2.height);
        }
    }
    // Three windows
    {
        const { qtMock, workspaceMock, world } = init(config);
        [client1, client2, client3] = workspaceMock.createClientsWithWidths(300, 300, 300);
        qtMock.fireShortcut("karousel-focus-left");
        qtMock.fireShortcut("karousel-window-move-left");
        qtMock.fireShortcut("karousel-focus-right");
        qtMock.fireShortcut("karousel-window-move-left");
        qtMock.fireShortcut("karousel-focus-up");
        qtMock.fireShortcut("karousel-focus-up");
        // Verify the layout
        {
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            const g3 = client3.getActualFrameGeometry();
            Assert.equal(g1.height, h3);
            Assert.equal(g2.height, h3);
            Assert.equal(g3.height, h3);
            Assert.equal(g1.width, 300);
            Assert.equal(g2.width, 300);
            Assert.equal(g3.width, 300);
            Assert.assert(g1.y + g1.height < g2.y);
            Assert.assert(g2.y + g2.height < g3.y);
        }
        // Upper window
        {
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            const g3 = client3.getActualFrameGeometry();
            qtMock.fireShortcut("karousel-window-height-increase-up"); // no-op
            const g1n1 = client1.getActualFrameGeometry();
            const g2n1 = client2.getActualFrameGeometry();
            const g3n1 = client3.getActualFrameGeometry();
            Assert.equal(g1.height, g1n1.height);
            Assert.equal(g2.height, g2n1.height);
            Assert.equal(g3.height, g3n1.height);
            qtMock.fireShortcut("karousel-window-height-increase-down");
            const g1n2 = client1.getActualFrameGeometry();
            const g2n2 = client2.getActualFrameGeometry();
            const g3n2 = client3.getActualFrameGeometry();
            Assert.equal(g1.height + stepSize, g1n2.height);
            Assert.equal(g2.height - stepSize, g2n2.height);
            Assert.equal(g3.height, g3n2.height);
        }
        // Middle window
        {
            qtMock.fireShortcut("karousel-focus-down");
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            const g3 = client3.getActualFrameGeometry();
            qtMock.fireShortcut("karousel-window-height-increase-up");
            const g1n1 = client1.getActualFrameGeometry();
            const g2n1 = client2.getActualFrameGeometry();
            const g3n1 = client3.getActualFrameGeometry();
            Assert.equal(g1.height - stepSize, g1n1.height);
            Assert.equal(g2.height + stepSize, g2n1.height);
            Assert.equal(g3.height, g3n1.height);
            qtMock.fireShortcut("karousel-window-height-increase-down");
            const g1n2 = client1.getActualFrameGeometry();
            const g2n2 = client2.getActualFrameGeometry();
            const g3n2 = client3.getActualFrameGeometry();
            Assert.equal(g1n1.height, g1n2.height);
            Assert.equal(g2n1.height + stepSize, g2n2.height);
            Assert.equal(g3n1.height - stepSize, g3n2.height);
        }
        // Lower window
        {
            qtMock.fireShortcut("karousel-focus-down");
            const g1 = client1.getActualFrameGeometry();
            const g2 = client2.getActualFrameGeometry();
            const g3 = client3.getActualFrameGeometry();
            qtMock.fireShortcut("karousel-window-height-increase-up");
            const g1n1 = client1.getActualFrameGeometry();
            const g2n1 = client2.getActualFrameGeometry();
            const g3n1 = client3.getActualFrameGeometry();
            Assert.equal(g1.height, g1n1.height);
            Assert.equal(g2.height - stepSize, g2n1.height);
            Assert.equal(g3.height + stepSize, g3n1.height);
            qtMock.fireShortcut("karousel-window-height-increase-down"); // no-op
            const g1n2 = client1.getActualFrameGeometry();
            const g2n2 = client2.getActualFrameGeometry();
            const g3n2 = client3.getActualFrameGeometry();
            Assert.equal(g1n1.height, g1n2.height);
            Assert.equal(g2n1.height, g2n2.height);
            Assert.equal(g3n1.height, g3n2.height);
        }
    }
});
tests.run();
