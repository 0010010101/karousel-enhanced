class Animator {
    private readonly animation: QmlObject;
    private currentValue: number;
    private callback: ((value: number) => void) | null;

    constructor(duration?: number, easingCurve?: string) {
        this.animation = Qt.createQmlObject(
            `import QtQuick 6.0
            Item {
                property real value: 0;
                NumberAnimation on value {
                    id: anim;
                    duration: ${duration};
                    easing.type: Easing.${easingCurve};
                }
            }`,
            qmlBase,
        );

        (this.animation as any).valueChanged.connect(() => {
            this.currentValue = (this.animation as any).value;
            if (this.callback !== null) {
                this.callback(this.currentValue);
            }
        });
    }

    public animate(from: number, to: number, callback: (value: number) => void) {
        const animObj = this.animation as any;
        animObj.value = from;
        this.callback = callback;
        animObj.value = to;
    }

    public stop() {
        const animObj = this.animation as any;
        animObj.value = animObj.value; // Stop at current value
        this.callback = null;
    }

    public destroy() {
        this.animation.destroy();
    }
}
