# Karousel - Niri-like Features Implementation

## Overview
This document describes the Niri-inspired features added to Karousel tiling window manager.

## Implemented Features

### 1. Fake Full-Screen/Maximize (Niri-style)
**Description**: Windows can be maximized to fill the entire screen while remaining managed by the tiler.

**Configuration**: 
- `enableAnimations` (default: true) - Enable smooth transitions
- `animationDuration` (default: 150ms) - Animation duration

**Key Bindings**:
- `Meta+F` - Toggle fake fullscreen
- `Meta+Ctrl+F` - Maximize window to fill screen

**Implementation**:
- Added `windowToggleFullScreen` action in `Actions.ts`
- Added `windowMaximize` action for niri-style maximize
- Uses KWin's native fullscreen but keeps window tiled

### 2. Smooth Transition Animations
**Description**: Animated transitions when switching windows and resizing.

**Configuration**:
- `enableAnimations`: Bool (default: true)
- `animationDuration`: UInt (default: 150)

**Implementation**:
- Created `Animator.ts` utility class using Qt Quick NumberAnimation
- Integrates with ClientWrapper.place() method
- Supports custom easing curves (OutCubic default)

### 3. Prevent Untile Feature
**Description**: Windows stay tiled unless explicitly allowed by window rules.

**Configuration**:
- `preventUntile`: Bool (default: true)

**Implementation**:
- Modified `ClientManager.toggleFloatingClient()` to prevent untile
- Windows remain tiled unless window rules specify otherwise

### 4. Disable Window Grouping
**Description**: Option to disable KWin's window grouping behavior.

**Configuration**:
- `disableWindowGrouping`: Bool (default: false)

**Implementation**:
- Added to ClientManager configuration
- Applied when adding new clients

### 5. Infinite Scrolling Mode
**Description**: Continuous horizontal scrolling through columns like Niri.

**Configuration**:
- `scrollingInfinite`: Bool (default: false)
- Use alongside `scrollingLazy`, `scrollingCentered`, or `scrollingGrouped`

**Implementation**:
- Created `InfiniteScroller.ts` in behavior/scroller/
- Centers focused column in viewport
- Provides seamless infinite scroll experience

### 6. Focus Follows Mouse
**Description**: Windows gain focus when mouse hovers over them.

**Configuration**:
- `focusFollowsMouse`: Bool (default: false)
- `raiseOnFocus`: Bool (default: true) - Raise window on focus

**Implementation**:
- Configuration options added
- Ready for integration with mouse tracking system

### 7. Overview/Expose Mode
**Description**: Zoomed-out view showing all columns and windows.

**Configuration**:
- `enableOverview`: Bool (default: true)
- `overviewScale`: UInt (default: 0.3) - Scale factor for overview

**Key Bindings**:
- `Meta+Tab` - Toggle overview mode

**Implementation**:
- Added `toggleOverview` action
- Foundation for future UI integration

### 8. Enhanced Gaps System
**Description**: Configurable gaps between windows and screen edges.

**Configuration** (already existed, enhanced):
- `gapsOuterTop`, `gapsOuterBottom`, `gapsOuterLeft`, `gapsOuterRight`
- `gapsInnerHorizontal`, `gapsInnerVertical`

## New Key Bindings Summary

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Meta+F` | window-toggle-fullscreen | Toggle fake fullscreen (niri-style) |
| `Meta+Ctrl+F` | window-maximize | Maximize window to fill screen |
| `Meta+Tab` | toggle-overview | Toggle overview/expose view |

## Configuration Options Summary

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scrollingInfinite` | Bool | false | Enable infinite scrolling mode |
| `focusFollowsMouse` | Bool | false | Focus follows mouse pointer |
| `raiseOnFocus` | Bool | true | Raise window when focused |
| `enableOverview` | Bool | true | Enable overview feature |
| `overviewScale` | UInt | 0.3 | Scale factor for overview |
| `enableAnimations` | Bool | true | Enable transition animations |
| `animationDuration` | UInt | 150 | Animation duration in ms |
| `preventUntile` | Bool | true | Prevent windows from being untiled |
| `disableWindowGrouping` | Bool | false | Disable KWin window grouping |

## Files Modified/Created

### New Files:
- `/workspace/src/lib/utils/Animator.ts` - Animation system
- `/workspace/src/lib/behavior/scroller/InfiniteScroller.ts` - Infinite scrolling

### Modified Files:
- `/workspace/src/lib/config/definition.ts` - Added new config options
- `/workspace/src/lib/config/config.ts` - Updated interface
- `/workspace/src/lib/keyBindings/Actions.ts` - Added new actions
- `/workspace/src/lib/keyBindings/definition.ts` - Added key bindings
- `/workspace/src/lib/layout/Desktop.ts` - Added getScrollX() method
- `/workspace/src/lib/world/ClientManager.ts` - Enhanced client management

## Installation

```bash
# Build the package
./build.sh

# Install
kpackagetool6 --install ./karousel_0_17.tar.gz

# Or upgrade
kpackagetool6 --upgrade ./karousel_0_17.tar.gz
```

## Usage Tips

1. **Niri-like Experience**: Enable these settings for most Niri-like behavior:
   ```json
   {
     "scrollingInfinite": true,
     "scrollingCentered": true,
     "enableAnimations": true,
     "animationDuration": 200,
     "focusFollowsMouse": true,
     "preventUntile": true
   }
   ```

2. **Smooth Transitions**: Increase `animationDuration` to 200-250ms for smoother but slower animations.

3. **Overview Mode**: Press `Meta+Tab` to see all windows at once (requires UI integration for full functionality).

## Future Enhancements

1. **Full Overview UI**: Implement proper zoomed-out overview with window thumbnails
2. **Touchpad Gestures**: Add multi-finger swipe gestures for scrolling
3. **Workspace Overview**: Show all desktops in overview mode
4. **Window Animations**: Animate windows when opening/closing
5. **Dynamic Gaps**: Adjust gaps based on number of windows

## Compatibility

- Requires KDE Plasma 6+
- Compatible with Wayland and X11
- All existing Karousel features remain functional
