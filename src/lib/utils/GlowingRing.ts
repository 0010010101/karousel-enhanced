class GlowingRing {
    private readonly ringElement: QmlObject | null;
    private visible = false;
    
    constructor() {
        const cfg: any = Config;
        if (cfg.enableGlowingRing) {
            this.ringElement = Qt.createQmlObject(
                `import QtQuick 6.0
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
                }`,
                qmlBase,
            );
        } else {
            this.ringElement = null;
        }
    }
    
    public show(x: number, y: number, width: number, height: number) {
        const cfg: any = Config;
        if (!this.ringElement || !cfg.enableGlowingRing) return;
        
        const ring = this.ringElement as any;
        ring.x = x - cfg.glowingRingWidth;
        ring.y = y - cfg.glowingRingWidth;
        ring.width = width + (cfg.glowingRingWidth * 2);
        ring.height = height + (cfg.glowingRingWidth * 2);
        ring.visible = true;
        ring.opacity = 0.8;
        this.visible = true;
    }
    
    public hide() {
        if (!this.ringElement || !this.visible) return;
        
        const ring = this.ringElement as any;
        ring.opacity = 0;
        
        // Hide after fade out
        this.visible = false;
    }
    
    public updatePosition(x: number, y: number, width: number, height: number) {
        const cfg: any = Config;
        if (!this.ringElement || !this.visible) return;
        
        const ring = this.ringElement as any;
        ring.x = x - cfg.glowingRingWidth;
        ring.y = y - cfg.glowingRingWidth;
        ring.width = width + (cfg.glowingRingWidth * 2);
        ring.height = height + (cfg.glowingRingWidth * 2);
    }
    
    public destroy() {
        if (this.ringElement) {
            (this.ringElement as any).destroy();
        }
    }
}
