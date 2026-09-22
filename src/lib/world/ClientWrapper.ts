class ClientWrapper {
    public readonly stateManager: ClientState.Manager;
    private readonly transients: ClientWrapper[];
    private readonly signalManager: SignalManager;
    public preferredWidth: number;
    private maximizedMode: MaximizedMode | undefined;
    private readonly manipulatingGeometry: Doer;
    private lastPlacement: QmlRect | null; // workaround for issue #19
    private animator: any | null = null;
    private static animationEnabled = false;
    private static animationDuration = 150;
    
    public static setAnimationConfig(enabled: boolean, duration: number) {
        ClientWrapper.animationEnabled = enabled;
        ClientWrapper.animationDuration = duration;
    }

    constructor(
        public readonly kwinClient: KwinClient,
        constructInitialState: (client: ClientWrapper) => ClientState.State,
        public transientFor: ClientWrapper | null,
        private readonly rulesSignalManager: SignalManager | null,
    ) {
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
        if (ClientWrapper.animationEnabled) {
            this.animator = Qt.createQmlObject(
                `import QtQuick 6.0
                Item {
                    property real xVal: 0;
                    property real yVal: 0;
                    property real wVal: 0;
                    property real hVal: 0;
                    property real opacityVal: 1;
                    
                    NumberAnimation on xVal { id: animX; duration: ${ClientWrapper.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on yVal { id: animY; duration: ${ClientWrapper.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on wVal { id: animW; duration: ${ClientWrapper.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on hVal { id: animH; duration: ${ClientWrapper.animationDuration}; easing.type: Easing.OutCubic; }
                    NumberAnimation on opacityVal { id: animOpacity; duration: ${ClientWrapper.animationDuration}; easing.type: Easing.OutCubic; }
                }`,
                qmlBase,
            );
        }
    }

    public place(x: number, y: number, width: number, height: number, animate = false) {
        if (animate && this.animator && ClientWrapper.animationEnabled) {
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
                    if (this.kwinClient.resize) return;
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
        } else {
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

    private moveTransient(dx: number, dy: number, kwinDesktops: KwinDesktop[]) {
        if (this.stateManager.getState() instanceof ClientState.Floating) {
            if (Clients.isOnOneOfVirtualDesktops(this.kwinClient, kwinDesktops)) {
                const frame = this.kwinClient.frameGeometry;
                this.kwinClient.frameGeometry = Qt.rect(
                    frame.x.round() + dx,
                    frame.y.round() + dy,
                    frame.width.round(),
                    frame.height.round(),
                );
            }

            for (const transient of this.transients) {
                transient.moveTransient(dx, dy, kwinDesktops);
            }
        }
    }

    public moveTransients(dx: number, dy: number) {
        for (const transient of this.transients) {
            transient.moveTransient(dx, dy, this.kwinClient.desktops);
        }
    }

    public focus() {
        Workspace.activeWindow = this.kwinClient;
    }

    public isFocused() {
        return Workspace.activeWindow === this.kwinClient;
    }

    public raise() {
        Workspace.raiseWindow(this.kwinClient);
    }

    public setMaximize(horizontally: boolean, vertically: boolean) {
        if (!this.kwinClient.maximizable) {
            this.maximizedMode = MaximizedMode.Unmaximized;
            return;
        }

        if (this.maximizedMode === undefined) {
            if (horizontally && vertically) {
                this.maximizedMode = MaximizedMode.Maximized;
            } else if (horizontally) {
                this.maximizedMode = MaximizedMode.Horizontally;
            } else if (vertically) {
                this.maximizedMode = MaximizedMode.Vertically;
            } else {
                this.maximizedMode = MaximizedMode.Unmaximized;
            }
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.setMaximize(vertically, horizontally);
        });
    }

    public setFullScreen(fullScreen: boolean) {
        if (!this.kwinClient.fullScreenable) {
            return;
        }

        this.manipulatingGeometry.do(() => {
            this.kwinClient.fullScreen = fullScreen;
        });
    }

    public getMaximizedMode() {
        return this.maximizedMode;
    }

    public isManipulatingGeometry(newGeometry: QmlRect | null) {
        if (newGeometry !== null && newGeometry === this.lastPlacement) {
            return true;
        }
        return this.manipulatingGeometry.isDoing();
    }

    private addTransient(transient: ClientWrapper) {
        this.transients.push(transient);
    }

    private removeTransient(transient: ClientWrapper) {
        const i = this.transients.indexOf(transient);
        this.transients.splice(i, 1);
    }

    public ensureTransientsVisible(screenSize: QmlRect) {
        for (const transient of this.transients) {
            if (transient.stateManager.getState() instanceof ClientState.Floating) {
                transient.ensureVisible(screenSize);
                transient.ensureTransientsVisible(screenSize);
            }
        }
    }

    public ensureVisible(screenSize: QmlRect) {
        if (!Clients.isOnVirtualDesktop(this.kwinClient, Workspace.currentDesktop)) {
            return;
        }
        const frame = roundQtRect(this.kwinClient.frameGeometry);
        if (frame.x < screenSize.x) {
            this.place(screenSize.x, frame.y, frame.width, frame.height);
        } else if (rectRight(frame) > rectRight(screenSize)) {
            this.place(rectRight(screenSize) - frame.width, frame.y, frame.width, frame.height);
        }
    }

    public destroy(passFocus: FocusPassing.Type) {
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

    private static initSignalManager(client: ClientWrapper) {
        const manager = new SignalManager();

        manager.connect(client.kwinClient.maximizedAboutToChange, (maximizedMode: MaximizedMode) => {
            if (maximizedMode !== MaximizedMode.Unmaximized && client.kwinClient.tile !== null) {
                client.kwinClient.tile = null;
            }
            client.maximizedMode = maximizedMode;
        });

        return manager;
    }
}
