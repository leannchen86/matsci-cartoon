import React, { useCallback, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Circle,
  Crosshair,
  Eye,
  Layers2,
  MousePointer2,
  RotateCcw,
  Triangle,
  Waves,
  Zap,
} from "lucide-react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Quaternion,
  Vector3,
} from "three";
import {
  BULB_END,
  centerline,
  createTeardropGeometry,
  surfacePoint,
} from "./teardropGeometry";

const TEARDROP_ROTATION = [0.02, -0.12, -0.055];
const TEARDROP_EULER = new Euler(...TEARDROP_ROTATION);
const TEARDROP_POSITION = new Vector3(0.92, -0.16, 0);
const TEARDROP_SCALE = 0.58;
const Z_AXIS = new Vector3(0, 0, 1);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function localToWorldPoint(point) {
  return point
    .clone()
    .multiplyScalar(TEARDROP_SCALE)
    .applyEuler(TEARDROP_EULER)
    .add(TEARDROP_POSITION);
}

function localToWorldNormal(normal) {
  return normal.clone().applyEuler(TEARDROP_EULER).normalize();
}

function worldSurfaceSample(u = 0.24, v = 0.24, source = "impact") {
  const cleanU = clamp(u);
  const cleanV = ((v % 1) + 1) % 1;
  const localPoint = surfacePoint(cleanU, cleanV);
  const localNormal = localPoint.clone().sub(centerline(cleanU)).normalize();
  const point = localToWorldPoint(localPoint);
  const normal = localToWorldNormal(localNormal);

  return {
    u: cleanU,
    v: cleanV,
    source,
    point: point.toArray(),
    normal: normal.toArray(),
  };
}

function pointFromSample(sample) {
  return new Vector3(...sample.point);
}

function normalFromSample(sample) {
  return new Vector3(...sample.normal).normalize();
}

function getFractureProgress(fractureStart) {
  if (!fractureStart) return 0;
  return clamp((Date.now() - fractureStart) / 1350);
}

function computeVisualState({ sample, force, cooling, tip, fractureStart }) {
  const tailness = smoothstep(BULB_END + 0.03, 0.95, sample.u);
  const neckness = smoothstep(0.29, 0.42, sample.u) * (1 - smoothstep(0.52, 0.65, sample.u));
  const tipGain = { flat: 0.58, round: 1, sharp: 1.9 }[tip] ?? 1;
  const residualCompression = lerp(38, 128, cooling);
  const residualCorePull = lerp(18, 115, cooling);
  const addedCompression = force * tipGain * (1 - tailness) * 0.66;
  const openingPull = force * tipGain * (0.08 + tailness * 1.78 + neckness * 0.34);
  const crackGate = residualCompression * (1 - tailness * 0.72) + 18 * (1 - neckness);
  const crackDrive = openingPull - crackGate;
  const danger = clamp((crackDrive + 24) / 104);
  const fractureProgress = getFractureProgress(fractureStart);

  return {
    addedCompression,
    crackDrive,
    crackGate,
    danger: Math.max(danger, fractureProgress * 0.95),
    fractureProgress,
    openingPull,
    residualCompression,
    residualCorePull,
    shell: clamp((residualCompression + addedCompression) / 176),
    tailness,
    tension: clamp((residualCorePull + openingPull * 0.55) / 168),
    tipGain,
  };
}

const stressVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPositionW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const stressFragmentShader = `
  uniform float uCooling;
  uniform float uDanger;
  uniform float uForce;
  uniform float uFracture;
  uniform float uShowStress;
  uniform float uShowWave;
  uniform float uTime;
  uniform float uTipGain;
  uniform vec2 uImpact;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  float smoothBand(float center, float width, float value) {
    return 1.0 - smoothstep(width * 0.72, width, abs(value - center));
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), 2.25);
    float bulb = 1.0 - smoothstep(0.32, 0.52, vUv.x);
    float tail = smoothstep(0.43, 0.96, vUv.x);
    float core = smoothstep(0.05, 0.22, vUv.x) * (1.0 - smoothstep(0.37, 0.76, vUv.x));
    float wrappedV = abs(vUv.y - uImpact.y);
    wrappedV = min(wrappedV, 1.0 - wrappedV);
    float hit = exp(-pow((vUv.x - uImpact.x) * 4.7, 2.0) - pow(wrappedV * 8.0, 2.0));
    float ripple = 0.5 + 0.5 * sin(vUv.x * 64.0 + sin(vUv.y * 24.0) * 2.0 + uTime * 1.35);
    float caustic = smoothstep(0.54, 1.0, ripple) * 0.32;
    vec3 prism = 0.55 + 0.45 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + vUv.x * 1.85 + vUv.y * 0.42 + uTime * 0.018));
    float stressBand = smoothstep(0.52, 0.98, 0.5 + 0.5 * sin(vUv.x * 34.0 + vUv.y * 21.0 + sin(vUv.y * 8.0)));
    float stressOptic = uCooling * (0.12 + fresnel * 0.38) * stressBand * (bulb * 0.72 + tail * 0.28);
    float compression = uCooling * (0.08 + fresnel * 0.48 + bulb * 0.1) + hit * uForce * uTipGain * (1.0 - tail) * 0.38;
    float tension = uCooling * core * 0.38 + tail * hit * uForce * uTipGain * 0.72 + uDanger * core * 0.18;
    float path = smoothBand(mix(1.02, 0.08, uFracture), 0.035 + uFracture * 0.04, vUv.x);
    float wake = path * smoothstep(0.02, 0.24, uFracture) * (0.35 + fresnel) * uShowWave;
    float crack = max(wake, uDanger * hit * tail);

    vec3 cyan = vec3(0.28, 0.95, 1.0);
    vec3 amber = vec3(1.0, 0.61, 0.2);
    vec3 red = vec3(1.0, 0.16, 0.11);
    vec3 white = vec3(0.88, 1.0, 1.0);
    vec3 color = cyan * compression + amber * tension + prism * stressOptic * 0.9 + red * crack * 1.1 + white * caustic * fresnel * 0.45;
    float alpha = uShowStress * clamp(0.05 + compression * 0.24 + tension * 0.24 + stressOptic * 0.3 + crack * 0.46 + caustic * 0.08, 0.0, 0.5);

    gl_FragColor = vec4(color, alpha);
  }
`;

const glassRimFragmentShader = `
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), 2.0);
    float body = smoothstep(0.015, 0.18, vUv.x) * (1.0 - smoothstep(0.94, 1.0, vUv.x));
    float filament = smoothstep(0.38, 0.96, vUv.x);
    float microLine = 0.5 + 0.5 * sin(vUv.x * 72.0 + vUv.y * 6.28318 + uTime * 0.45);
    float caustic = smoothstep(0.72, 1.0, microLine) * body;
    float rim = fresnel * (0.42 + body * 0.58 + filament * 0.22);

    vec3 ice = vec3(0.66, 0.98, 1.0);
    vec3 warm = vec3(1.0, 0.78, 0.44);
    vec3 color = mix(ice, warm, filament * 0.16) * rim + ice * caustic * 0.12;
    float alpha = clamp(rim * 0.58 + caustic * 0.12, 0.0, 0.62);

    gl_FragColor = vec4(color, alpha);
  }
`;

const backdropVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backdropFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float grid = smoothstep(0.965, 1.0, abs(sin((p.x * 14.0 + p.y * 2.0) * 3.14159)))
      + smoothstep(0.972, 1.0, abs(sin((p.y * 10.0 - p.x * 1.5) * 3.14159)));
    float caustic = 0.5 + 0.5 * sin((p.x * 16.0 + sin(p.y * 9.0 + uTime * 0.6)) * 1.6);
    caustic = smoothstep(0.72, 1.0, caustic);
    float vignette = smoothstep(0.92, 0.12, length(p));
    vec3 base = vec3(0.012, 0.05, 0.052);
    vec3 cyan = vec3(0.22, 0.95, 1.0);
    vec3 amber = vec3(1.0, 0.54, 0.18);
    vec3 color = base + cyan * (grid * 0.055 + caustic * 0.048) + amber * caustic * 0.015;
    gl_FragColor = vec4(color, 0.72 * vignette);
  }
`;

function CausticBackdrop() {
  const materialRef = useRef(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <mesh position={[1.2, 0, -2.9]}>
      <planeGeometry args={[13, 7.4, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={backdropVertexShader}
        fragmentShader={backdropFragmentShader}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

function StressMaterial({ layers, impact, force, cooling, model, fractureStart }) {
  const materialRef = useRef(null);
  const uniforms = useMemo(
    () => ({
      uCooling: { value: cooling },
      uDanger: { value: model.danger },
      uForce: { value: force / 100 },
      uFracture: { value: 0 },
      uImpact: { value: { x: impact.u, y: impact.v } },
      uShowStress: { value: layers.stress ? 1 : 0 },
      uShowWave: { value: layers.wave ? 1 : 0 },
      uTime: { value: 0 },
      uTipGain: { value: model.tipGain },
    }),
    [],
  );

  useFrame(({ clock }) => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.uCooling.value = cooling;
    material.uniforms.uDanger.value = model.danger;
    material.uniforms.uForce.value = force / 100;
    material.uniforms.uFracture.value = getFractureProgress(fractureStart);
    material.uniforms.uImpact.value.x = impact.u;
    material.uniforms.uImpact.value.y = impact.v;
    material.uniforms.uShowStress.value = layers.stress ? 1 : 0;
    material.uniforms.uShowWave.value = layers.wave ? 1 : 0;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uTipGain.value = model.tipGain;
  });

  return (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={stressVertexShader}
      fragmentShader={stressFragmentShader}
      transparent
      depthTest={false}
      depthWrite={false}
      blending={AdditiveBlending}
    />
  );
}

function GlassRimMaterial() {
  const materialRef = useRef(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={stressVertexShader}
      fragmentShader={glassRimFragmentShader}
      transparent
      depthWrite={false}
      blending={AdditiveBlending}
      side={DoubleSide}
    />
  );
}

function TeardropBody({
  cooling,
  force,
  impact,
  layers,
  model,
  onImpact,
  tip,
  fractureStart,
}) {
  const shellGeometry = useMemo(() => createTeardropGeometry(112, 260), []);
  const coreGeometry = useMemo(
    () => createTeardropGeometry(70, 190, { radiusScale: 0.28, minRadius: 0.001 }),
    [],
  );

  const handlePress = useCallback(
    (event) => {
      if (!event.uv) return;
      event.stopPropagation();
      onImpact(worldSurfaceSample(event.uv.x, event.uv.y, "impact"));
    },
    [onImpact],
  );

  return (
    <>
      <group
        position={TEARDROP_POSITION}
        rotation={TEARDROP_ROTATION}
        scale={TEARDROP_SCALE}
      >
        <mesh
          geometry={shellGeometry}
          onPointerDown={handlePress}
          renderOrder={2}
        >
          <meshPhysicalMaterial
            color="#dffcff"
            transparent
            opacity={0.34}
            roughness={0.012}
            metalness={0}
            transmission={0.62}
            thickness={1.25}
            ior={1.46}
            reflectivity={0.92}
            clearcoat={1}
            clearcoatRoughness={0.02}
            attenuationColor="#9ff4ff"
            attenuationDistance={2.2}
            iridescence={0.14}
            iridescenceIOR={1.33}
            envMapIntensity={1.55}
            depthWrite={false}
          />
        </mesh>

        <mesh geometry={shellGeometry} raycast={() => null} renderOrder={3}>
          <GlassRimMaterial />
        </mesh>

        <mesh geometry={shellGeometry} raycast={() => null} renderOrder={4}>
          <StressMaterial
            cooling={cooling}
            force={force}
            fractureStart={fractureStart}
            impact={impact}
            layers={layers}
            model={model}
            tip={tip}
          />
        </mesh>

        <mesh
          geometry={coreGeometry}
          raycast={() => null}
          renderOrder={1}
          visible={layers.stress && force > 2}
        >
          <meshBasicMaterial
            color="#ffae49"
            transparent
            opacity={0.006 + cooling * 0.012 + model.tension * 0.008}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      </group>

      <CompressionShellLines cooling={cooling} visible={layers.stress} />
      <ForceArrow force={force} model={model} sample={impact} tip={tip} visible={layers.force} />
      <ForcePathLines
        force={force}
        model={model}
        sample={impact}
        tip={tip}
        visible={layers.force}
      />
      <FracturePath
        danger={model.danger}
        fractureStart={fractureStart}
        sample={impact}
        visible={layers.crack}
      />
    </>
  );
}

function lineGeometry(points) {
  return new BufferGeometry().setFromPoints(points);
}

function liftedSurfacePoint(u, v, lift = 0.018) {
  const sample = worldSurfaceSample(u, v);
  return pointFromSample(sample).add(normalFromSample(sample).multiplyScalar(lift));
}

function makeRingGeometry(u, lift = 0.018) {
  const points = [];
  for (let i = 0; i <= 96; i += 1) {
    points.push(liftedSurfacePoint(u, i / 96, lift));
  }
  return lineGeometry(points);
}

function CompressionShellLines({ cooling, visible }) {
  const rings = useMemo(
    () => [0.07, 0.15, 0.28, 0.43].map((u) => makeRingGeometry(u, 0.012)),
    [],
  );
  const opacity = visible ? 0.018 + cooling * 0.048 : 0;

  return (
    <group renderOrder={5}>
      {rings.map((geometry, index) => (
        <line key={index} geometry={geometry} raycast={() => null}>
          <lineBasicMaterial
            color="#8ff8ff"
            transparent
            opacity={opacity * (1 - index * 0.14)}
            blending={AdditiveBlending}
            depthTest={false}
            depthWrite={false}
          />
        </line>
      ))}
    </group>
  );
}

function ForceArrow({ force, model, sample, tip, visible }) {
  const arrowRef = useRef(null);
  const ringRadius = { flat: 0.16, round: 0.09, sharp: 0.045 }[tip] ?? 0.09;
  const point = useMemo(() => pointFromSample(sample), [sample]);
  const normal = useMemo(() => normalFromSample(sample), [sample]);
  const contactQuaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(Z_AXIS, normal.clone().normalize()),
    [normal],
  );
  const color = useMemo(
    () => new Color().setStyle(model.danger > 0.68 ? "#ff5342" : "#ffd167"),
    [model.danger],
  );

  useFrame(() => {
    const arrow = arrowRef.current;
    if (!arrow) return;
    const clampedForce = force / 100;
    const length = 0.22 + clampedForce * 0.58;
    const origin = point.clone().add(normal.clone().multiplyScalar(0.28 + clampedForce * 0.4));
    arrow.position.copy(origin);
    arrow.setDirection(normal.clone().multiplyScalar(-1));
    arrow.setLength(length, 0.09 + clampedForce * 0.05, 0.045 + clampedForce * 0.025);
    arrow.setColor(color);
    arrow.visible = visible && force > 1;
    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.42;
    arrow.line.material.depthTest = false;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.56;
    arrow.cone.material.depthTest = false;
  });

  if (!visible || force < 2) return null;

  return (
    <>
      <arrowHelper ref={arrowRef} args={[normal.clone().multiplyScalar(-1), point, 1, color]} />
      <mesh
        position={point.clone().add(normal.clone().multiplyScalar(0.025))}
        quaternion={contactQuaternion}
        raycast={() => null}
        renderOrder={6}
      >
        <torusGeometry args={[ringRadius, 0.006, 10, 80]} />
        <meshBasicMaterial
          color={model.danger > 0.68 ? "#ff4d3d" : "#9df6ff"}
          transparent
          opacity={0.48 + model.danger * 0.28}
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function makeSurfaceArc(sample, vOffset, span, steps, lift) {
  const points = [];
  const v = sample.v + vOffset;
  const start = clamp(sample.u - span * 0.42, 0.012, 0.99);
  const end = clamp(sample.u + span, 0.012, 0.99);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push(liftedSurfacePoint(lerp(start, end, t), v, lift));
  }
  return lineGeometry(points);
}

function makeCorePath(sample, steps) {
  const points = [];
  const start = clamp(sample.u, 0.02, 0.98);
  const end = sample.u < 0.46 ? 0.22 : 0.91;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = lerp(start, end, t);
    const center = localToWorldPoint(centerline(u));
    const skin = liftedSurfacePoint(u, sample.v, 0.004);
    points.push(center.lerp(skin, 0.24 + 0.08 * Math.sin(t * Math.PI)));
  }
  return lineGeometry(points);
}

function ForcePathLines({ force, model, sample, visible }) {
  const geometries = useMemo(
    () => [
      makeSurfaceArc(sample, -0.09, 0.22, 54, 0.026),
      makeSurfaceArc(sample, 0, 0.28, 66, 0.028),
      makeSurfaceArc(sample, 0.09, 0.22, 54, 0.026),
      makeCorePath(sample, 64),
    ],
    [sample],
  );

  if (!visible || force < 2) return null;

  return (
    <group renderOrder={7}>
      {geometries.map((geometry, index) => {
        const isCore = index === geometries.length - 1;
        return (
          <line key={index} geometry={geometry} raycast={() => null}>
            <lineBasicMaterial
              color={isCore ? "#ffad45" : "#62f0ff"}
              transparent
              opacity={
                isCore
                  ? 0.1 + model.tension * 0.42 + model.tailness * 0.24
                  : 0.12 + model.shell * 0.38
              }
              blending={AdditiveBlending}
              depthTest={false}
              depthWrite={false}
            />
          </line>
        );
      })}
    </group>
  );
}

function makeFractureGeometry(v) {
  const points = [];
  for (let i = 0; i <= 154; i += 1) {
    const t = i / 154;
    const u = lerp(0.995, 0.055, t);
    const center = localToWorldPoint(centerline(u));
    const skin = liftedSurfacePoint(u, v + Math.sin(t * 5.4) * 0.018, 0.012);
    points.push(center.lerp(skin, 0.38 + 0.1 * Math.sin(t * Math.PI * 2.0)));
  }
  return lineGeometry(points);
}

function FracturePath({ danger, fractureStart, sample, visible }) {
  const materialRef = useRef(null);
  const geometry = useMemo(() => makeFractureGeometry(sample.v), [sample.v]);
  const count = geometry.attributes.position.count;

  useFrame(() => {
    const fractureProgress = getFractureProgress(fractureStart);
    const preview = danger > 0.62 ? lerp(0.02, 0.13, danger) : 0;
    const progress = Math.max(fractureProgress, preview);
    geometry.setDrawRange(0, Math.max(2, Math.floor(count * progress)));
    if (materialRef.current) {
      materialRef.current.opacity = fractureStart ? 0.92 : clamp((danger - 0.48) * 1.3, 0, 0.52);
      materialRef.current.color.setStyle(fractureStart ? "#fff3d6" : "#ff4939");
    }
  });

  if (!visible) return null;

  return (
    <line geometry={geometry} raycast={() => null} renderOrder={8}>
      <lineBasicMaterial
        ref={materialRef}
        color="#ff4939"
        transparent
        opacity={0}
        blending={AdditiveBlending}
        depthTest={false}
        depthWrite={false}
      />
    </line>
  );
}

function Scene(props) {
  return (
    <Canvas
      camera={{ position: [0.25, 1.0, 7.55], fov: 40, near: 0.1, far: 80 }}
      dpr={[1, 1.45]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#030607"]} />
      <fog attach="fog" args={["#030607", 9.5, 15]} />
      <ambientLight intensity={0.46} color="#bffbff" />
      <directionalLight position={[-4, 3.8, 5]} intensity={1.55} color="#e9ffff" />
      <pointLight position={[3.3, -1.6, 4.4]} intensity={2.35} color="#ffb453" distance={9} />
      <pointLight position={[-3.6, 2.8, 2.6]} intensity={1.7} color="#50ecff" distance={8} />
      <CausticBackdrop />
      <TeardropBody {...props} />
      <OrbitControls
        enableDamping
        enablePan={false}
        maxDistance={9.2}
        minDistance={4.8}
        rotateSpeed={0.62}
        target={[-0.18, 0.08, 0]}
      />
    </Canvas>
  );
}

function IconButton({ active, children, className = "", title, ...props }) {
  return (
    <button
      className={`${className} ${active ? "active" : ""}`.trim()}
      title={title}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function LayerDock({ layers, setLayers }) {
  const items = [
    ["stress", Eye, "stress color"],
    ["force", Crosshair, "force paths"],
    ["crack", Zap, "crack path"],
    ["wave", Waves, "release wave"],
  ];

  return (
    <div className="layerDock" aria-label="view layers">
      {items.map(([key, Icon, label]) => (
        <IconButton
          key={key}
          active={layers[key]}
          className="iconButton"
          onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
          title={label}
        >
          <Icon size={17} strokeWidth={2.1} />
        </IconButton>
      ))}
    </div>
  );
}

function TipButton({ active, icon, label, onClick }) {
  const Icon = icon;
  return (
    <IconButton active={active} className="tipButton" onClick={onClick} title={label}>
      <Icon size={16} strokeWidth={2.2} />
    </IconButton>
  );
}

function ToolDock({
  cooling,
  force,
  onReset,
  onSnapTail,
  setCooling,
  setForce,
  setTip,
  setTool,
  tip,
  tool,
}) {
  return (
    <div className="toolDock" aria-label="simulation controls">
      <div className="toolGroup">
        <IconButton
          active={tool === "push"}
          className="modeButton"
          onClick={() => setTool("push")}
          title="click to push"
        >
          <MousePointer2 size={17} />
          <span>Push</span>
        </IconButton>
        <IconButton
          active={tool === "snap"}
          className="modeButton danger"
          onClick={onSnapTail}
          title="snap the tail"
        >
          <Zap size={17} />
          <span>Snap</span>
        </IconButton>
      </div>

      <div className="toolGroup compact">
        <TipButton active={tip === "flat"} icon={Layers2} label="flat tip" onClick={() => setTip("flat")} />
        <TipButton active={tip === "round"} icon={Circle} label="round tip" onClick={() => setTip("round")} />
        <TipButton active={tip === "sharp"} icon={Triangle} label="sharp tip" onClick={() => setTip("sharp")} />
      </div>

      <label className="sliderControl">
        <span>Force</span>
        <input
          aria-label="force"
          max="100"
          min="0"
          onChange={(event) => setForce(Number(event.target.value))}
          type="range"
          value={force}
        />
        <b>{force}</b>
      </label>

      <label className="sliderControl">
        <span>Cooling</span>
        <input
          aria-label="cooling"
          max="100"
          min="0"
          onChange={(event) => setCooling(Number(event.target.value) / 100)}
          type="range"
          value={Math.round(cooling * 100)}
        />
        <b>{Math.round(cooling * 100)}</b>
      </label>

      <IconButton className="iconButton resetButton" onClick={onReset} title="reset">
        <RotateCcw size={17} />
      </IconButton>
    </div>
  );
}

export default function App() {
  const [cooling, setCooling] = useState(0.88);
  const [force, setForce] = useState(0);
  const [fractureStart, setFractureStart] = useState(null);
  const [impact, setImpact] = useState(() => worldSurfaceSample(0.24, 0.23, "impact"));
  const [layers, setLayers] = useState({
    crack: false,
    force: false,
    stress: true,
    wave: true,
  });
  const [tip, setTip] = useState("round");
  const [tool, setTool] = useState("push");

  const model = useMemo(
    () => computeVisualState({ cooling, force, fractureStart, sample: impact, tip }),
    [cooling, force, fractureStart, impact, tip],
  );

  const handleImpact = useCallback(
    (sample) => {
      setImpact(sample);
      if (tool === "snap" || sample.u > 0.72) {
        setTool("snap");
        setFractureStart(Date.now());
      } else {
        setFractureStart(null);
      }
    },
    [tool],
  );

  const snapTail = useCallback(() => {
    const sample = worldSurfaceSample(0.9, 0.22, "impact");
    setImpact(sample);
    setTool("snap");
    setFractureStart(Date.now());
  }, []);

  const reset = useCallback(() => {
    const sample = worldSurfaceSample(0.24, 0.23, "impact");
    setCooling(0.88);
    setForce(0);
    setFractureStart(null);
    setImpact(sample);
    setTip("round");
    setTool("push");
  }, []);

  return (
    <main className="appShell">
      <section className="scenePanel" aria-label="Prince Rupert's drop simulator">
        <Scene
          cooling={cooling}
          force={force}
          fractureStart={fractureStart}
          impact={impact}
          layers={layers}
          model={model}
          onImpact={handleImpact}
          tip={tip}
        />
      </section>

      <div className="topBar">
        <div>
          <span className="eyebrow">Prince Rupert's drop</span>
          <h1>Residual stress simulator</h1>
        </div>
        <div className="miniKey" aria-hidden="true">
          <span className="keyDot cyan" />
          <span className="keyDot amber" />
          <span className="keyDot red" />
        </div>
      </div>

      <LayerDock layers={layers} setLayers={setLayers} />
      <ToolDock
        cooling={cooling}
        force={force}
        onReset={reset}
        onSnapTail={snapTail}
        setCooling={setCooling}
        setForce={setForce}
        setTip={setTip}
        setTool={setTool}
        tip={tip}
        tool={tool}
      />
    </main>
  );
}
