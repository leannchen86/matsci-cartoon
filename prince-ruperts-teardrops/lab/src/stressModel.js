import { clamp, lerp, smoothstep, sampleArray } from "./math.js";
import { spine, radiusAt } from "./geometry.js";

const stressRadialNodes = 34;
const stressTimeSteps = 360;
const glassTransition = 0.82;
const femAxialNodes = 34;
const femRadialNodes = 12;
const femMaxIterations = 900;

// Residual-stress model for a cooled drop: infer frozen-in shrinkage from
// a radial quench history, then solve elastic equilibrium on a t-rho mesh.
export function buildStressModel(params) {
  const axialCount = femAxialNodes;
  const radialCount = femRadialNodes;
  const nodeCount = axialCount * radialCount;
  const dofCount = nodeCount * 2;
  const radii = new Float32Array(axialCount);
  const arc = new Float32Array(axialCount);
  const freeStrain = new Float32Array(nodeCount);
  const nodalStress = new Float32Array(nodeCount);
  let maxRadius = 0;

  let previousCenter = null;
  for (let i = 0; i < axialCount; i += 1) {
    const t = i / (axialCount - 1);
    const radius = radiusAt(t, params);
    maxRadius = Math.max(maxRadius, radius);
    radii[i] = radius;

    const center = spine(t, params);
    if (previousCenter) {
      arc[i] = arc[i - 1] + center.distanceTo(previousCenter);
    }
    previousCenter = center;
  }

  const lockTimes = [];
  let meanLock = 0;
  let meanWeight = 0;

  for (let i = 0; i < axialCount; i += 1) {
    const radiusNorm = clamp(radii[i] / Math.max(maxRadius, 1), 0.06, 1);
    const locks = solveCoolingColumn(radiusNorm, params.quench);
    lockTimes.push(locks);

    for (let k = 0; k < radialCount; k += 1) {
      const rho = k / (radialCount - 1);
      const lock = sampleArray(locks, rho);
      const areaWeight = Math.max(rho, 0.35 / (radialCount - 1)) *
        smoothstep(0.025, 0.16, radii[i] / Math.max(maxRadius, 1));
      meanLock += lock * areaWeight;
      meanWeight += areaWeight;
    }
  }

  meanLock /= Math.max(meanWeight, 1e-6);

  for (let i = 0; i < axialCount; i += 1) {
    const capacity = smoothstep(0.025, 0.16, radii[i] / Math.max(maxRadius, 1));
    for (let k = 0; k < radialCount; k += 1) {
      const rho = k / (radialCount - 1);
      const index = i * radialCount + k;
      freeStrain[index] = (sampleArray(lockTimes[i], rho) - meanLock) * capacity;
    }
  }

  const system = createSparseSystem(dofCount);
  const rhs = new Float32Array(dofCount);
  const elementStress = [];
  const dMatrix = planeStressMatrix(1, 0.22);

  for (let i = 0; i < axialCount - 1; i += 1) {
    for (let k = 0; k < radialCount - 1; k += 1) {
      assembleElement(system, rhs, elementStress, {
        i,
        k,
        axialCount,
        radialCount,
        arc,
        radii,
        freeStrain,
        dMatrix
      });
    }
  }

  const diagonalAverage = averageDiagonal(system);
  pinDof(system, rhs, nodeDof(radialCount, 0, 0, 0), diagonalAverage);
  pinDof(system, rhs, nodeDof(radialCount, 0, 0, 1), diagonalAverage);
  pinDof(system, rhs, nodeDof(radialCount, axialCount - 1, 0, 1), diagonalAverage);

  const displacement = conjugateGradient(system, rhs, femMaxIterations, 1e-5);
  const weights = new Float32Array(nodeCount);
  let minStress = 0;
  let maxStress = 0;

  elementStress.forEach((element) => {
    const stressValue = evaluateElementStress(element, displacement, dMatrix);
    element.nodes.forEach((nodeIndex) => {
      nodalStress[nodeIndex] += stressValue;
      weights[nodeIndex] += 1;
    });
  });

  for (let index = 0; index < nodeCount; index += 1) {
    if (weights[index] > 0) {
      nodalStress[index] /= weights[index];
    }
  }

  const headIndex = Math.max(1, Math.round(params.headPos * (axialCount - 1)));
  const coreHead = nodalStress[headIndex * radialCount];
  const surfaceHead = nodalStress[headIndex * radialCount + radialCount - 1];
  const sign = coreHead < surfaceHead ? -1 : 1;

  for (let index = 0; index < nodeCount; index += 1) {
    nodalStress[index] *= sign;
    minStress = Math.min(minStress, nodalStress[index]);
    maxStress = Math.max(maxStress, nodalStress[index]);
  }

  const compressionScale = minStress < 0 ? 650 / Math.abs(minStress) : 0;
  const tensionScale = maxStress > 0 ? 420 / maxStress : 0;
  const scale = Math.min(compressionScale || tensionScale, tensionScale || compressionScale);
  minStress = 0;
  maxStress = 0;

  for (let index = 0; index < nodeCount; index += 1) {
    nodalStress[index] *= scale;
    minStress = Math.min(minStress, nodalStress[index]);
    maxStress = Math.max(maxStress, nodalStress[index]);
  }

  return {
    min: minStress,
    max: maxStress,
    sample(t, rho) {
      const u = clamp(t, 0, 1) * (axialCount - 1);
      const v = clamp(rho, 0, 1) * (radialCount - 1);
      const i0 = Math.floor(u);
      const k0 = Math.floor(v);
      const i1 = Math.min(i0 + 1, axialCount - 1);
      const k1 = Math.min(k0 + 1, radialCount - 1);
      const fu = u - i0;
      const fv = v - k0;
      const a = nodalStress[i0 * radialCount + k0];
      const b = nodalStress[i1 * radialCount + k0];
      const c = nodalStress[i0 * radialCount + k1];
      const d = nodalStress[i1 * radialCount + k1];
      return lerp(lerp(a, b, fu), lerp(c, d, fu), fv);
    }
  };
}

function assembleElement(system, rhs, elementStress, data) {
  const { i, k, radialCount, arc, radii, freeStrain, dMatrix } = data;
  const nodeIds = [
    i * radialCount + k,
    (i + 1) * radialCount + k,
    (i + 1) * radialCount + k + 1,
    i * radialCount + k + 1
  ];
  const dofs = [
    nodeIds[0] * 2,
    nodeIds[0] * 2 + 1,
    nodeIds[1] * 2,
    nodeIds[1] * 2 + 1,
    nodeIds[2] * 2,
    nodeIds[2] * 2 + 1,
    nodeIds[3] * 2,
    nodeIds[3] * 2 + 1
  ];
  const x = [
    arc[i],
    arc[i + 1],
    arc[i + 1],
    arc[i]
  ];
  const y = [
    (k / (radialCount - 1)) * radii[i],
    (k / (radialCount - 1)) * radii[i + 1],
    ((k + 1) / (radialCount - 1)) * radii[i + 1],
    ((k + 1) / (radialCount - 1)) * radii[i]
  ];
  const areaGate = smoothstep(1.5, 8, Math.max(radii[i], radii[i + 1]));
  if (areaGate <= 0) {
    return;
  }

  const elementStrain = (
    freeStrain[nodeIds[0]] +
    freeStrain[nodeIds[1]] +
    freeStrain[nodeIds[2]] +
    freeStrain[nodeIds[3]]
  ) * 0.25;
  const stressRecord = {
    nodes: nodeIds,
    dofs,
    samples: []
  };
  const gauss = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

  gauss.forEach((xi) => {
    gauss.forEach((eta) => {
      const sample = elementSample(x, y, xi, eta);
      const weight = Math.max(sample.detJ, 0) * areaGate;
      if (weight <= 1e-8) {
        return;
      }

      const db = multiplyDB(dMatrix, sample.b);
      for (let a = 0; a < 8; a += 1) {
        for (let b = 0; b < 8; b += 1) {
          addSparse(system, dofs[a], dofs[b], dotColumn(sample.b, db, a, b) * weight);
        }
      }

      const thermal = [
        elementStrain,
        elementStrain,
        0
      ];
      const dThermal = multiplyMatrixVector(dMatrix, thermal);
      for (let a = 0; a < 8; a += 1) {
        rhs[dofs[a]] += dotBVector(sample.b, dThermal, a) * weight;
      }

      stressRecord.samples.push({
        b: sample.b,
        thermal
      });
    });
  });

  if (stressRecord.samples.length > 0) {
    elementStress.push(stressRecord);
  }
}

function elementSample(x, y, xi, eta) {
  const dNdxi = [
    -(1 - eta) * 0.25,
    (1 - eta) * 0.25,
    (1 + eta) * 0.25,
    -(1 + eta) * 0.25
  ];
  const dNdeta = [
    -(1 - xi) * 0.25,
    -(1 + xi) * 0.25,
    (1 + xi) * 0.25,
    (1 - xi) * 0.25
  ];
  let j00 = 0;
  let j01 = 0;
  let j10 = 0;
  let j11 = 0;

  for (let n = 0; n < 4; n += 1) {
    j00 += dNdxi[n] * x[n];
    j01 += dNdxi[n] * y[n];
    j10 += dNdeta[n] * x[n];
    j11 += dNdeta[n] * y[n];
  }

  const detJ = j00 * j11 - j01 * j10;
  const b = new Float32Array(24);
  if (Math.abs(detJ) < 1e-8) {
    return { b, detJ: 0 };
  }
  const inv00 = j11 / detJ;
  const inv01 = -j01 / detJ;
  const inv10 = -j10 / detJ;
  const inv11 = j00 / detJ;

  for (let n = 0; n < 4; n += 1) {
    const dNdx = inv00 * dNdxi[n] + inv01 * dNdeta[n];
    const dNdy = inv10 * dNdxi[n] + inv11 * dNdeta[n];
    const col = n * 2;
    b[col] = dNdx;
    b[8 + col + 1] = dNdy;
    b[16 + col] = dNdy;
    b[16 + col + 1] = dNdx;
  }

  return { b, detJ: Math.abs(detJ) };
}

function planeStressMatrix(elasticModulus, poissonRatio) {
  const c = elasticModulus / (1 - poissonRatio * poissonRatio);
  return new Float32Array([
    c,
    c * poissonRatio,
    0,
    c * poissonRatio,
    c,
    0,
    0,
    0,
    c * (1 - poissonRatio) * 0.5
  ]);
}

function multiplyDB(dMatrix, bMatrix) {
  const result = new Float32Array(24);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      result[row * 8 + col] =
        dMatrix[row * 3] * bMatrix[col] +
        dMatrix[row * 3 + 1] * bMatrix[8 + col] +
        dMatrix[row * 3 + 2] * bMatrix[16 + col];
    }
  }
  return result;
}

function multiplyMatrixVector(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
  ];
}

function dotColumn(bMatrix, dbMatrix, a, b) {
  return bMatrix[a] * dbMatrix[b] +
    bMatrix[8 + a] * dbMatrix[8 + b] +
    bMatrix[16 + a] * dbMatrix[16 + b];
}

function dotBVector(bMatrix, vector, column) {
  return bMatrix[column] * vector[0] +
    bMatrix[8 + column] * vector[1] +
    bMatrix[16 + column] * vector[2];
}

function evaluateElementStress(element, displacement, dMatrix) {
  let signed = 0;
  element.samples.forEach((sample) => {
    const strain = [0, 0, 0];
    for (let a = 0; a < 8; a += 1) {
      const value = displacement[element.dofs[a]];
      strain[0] += sample.b[a] * value;
      strain[1] += sample.b[8 + a] * value;
      strain[2] += sample.b[16 + a] * value;
    }

    strain[0] -= sample.thermal[0];
    strain[1] -= sample.thermal[1];
    strain[2] -= sample.thermal[2];

    const sigma = multiplyMatrixVector(dMatrix, strain);
    const mean = (sigma[0] + sigma[1]) * 0.5;
    const radius = Math.sqrt(Math.pow((sigma[0] - sigma[1]) * 0.5, 2) + sigma[2] * sigma[2]);
    const principalMax = mean + radius;
    const principalMin = mean - radius;
    signed += principalMax > Math.abs(principalMin) ? principalMax : principalMin;
  });

  return signed / element.samples.length;
}

function createSparseSystem(size) {
  return Array.from({ length: size }, () => new Map());
}

function addSparse(system, row, col, value) {
  system[row].set(col, (system[row].get(col) || 0) + value);
}

function averageDiagonal(system) {
  let total = 0;
  let count = 0;
  system.forEach((row, index) => {
    if (row.has(index)) {
      total += Math.abs(row.get(index));
      count += 1;
    }
  });
  return count > 0 ? total / count : 1;
}

function pinDof(system, rhs, dof, diagonalAverage) {
  const penalty = Math.max(diagonalAverage, 1) * 100000;
  addSparse(system, dof, dof, penalty);
  rhs[dof] = 0;
}

function nodeDof(radialCount, axialIndex, radialIndex, component) {
  return ((axialIndex * radialCount + radialIndex) * 2) + component;
}

function conjugateGradient(system, rhs, maxIterations, tolerance) {
  const n = rhs.length;
  const x = new Float32Array(n);
  const r = new Float32Array(rhs);
  const p = new Float32Array(rhs);
  const ap = new Float32Array(n);
  let rsOld = dotVector(r, r);
  const target = Math.max(tolerance * tolerance * rsOld, 1e-18);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    multiplySparse(system, p, ap);
    const alpha = rsOld / Math.max(dotVector(p, ap), 1e-18);

    for (let i = 0; i < n; i += 1) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
    }

    const rsNew = dotVector(r, r);
    if (rsNew < target) {
      break;
    }

    const beta = rsNew / rsOld;
    for (let i = 0; i < n; i += 1) {
      p[i] = r[i] + beta * p[i];
    }
    rsOld = rsNew;
  }

  return x;
}

function multiplySparse(system, vector, out) {
  out.fill(0);
  system.forEach((row, rowIndex) => {
    let sum = 0;
    row.forEach((value, colIndex) => {
      sum += value * vector[colIndex];
    });
    out[rowIndex] = sum;
  });
}

function dotVector(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function solveCoolingColumn(radiusNorm, quench) {
  const radialCount = stressRadialNodes;
  const dr = 1 / (radialCount - 1);
  const dt = 0.018;
  const temp = new Float32Array(radialCount);
  const next = new Float32Array(radialCount);
  const lockTimes = new Float32Array(radialCount);
  const lower = new Float32Array(radialCount);
  const diag = new Float32Array(radialCount);
  const upper = new Float32Array(radialCount);
  const rhs = new Float32Array(radialCount);
  const previous = new Float32Array(radialCount);
  const cPrime = new Float32Array(radialCount);
  const dPrime = new Float32Array(radialCount);

  temp.fill(1);
  lockTimes.fill(-1);

  const radiusTerm = 1 / Math.max(radiusNorm * radiusNorm, 0.014);
  const thermalDiffusivity = 0.012;
  const surfaceCooling = quench * (1.15 + 1.35 * (1 - radiusNorm));

  for (let step = 1; step <= stressTimeSteps; step += 1) {
    previous.set(temp);

    for (let k = 0; k < radialCount; k += 1) {
      lower[k] = 0;
      upper[k] = 0;
      rhs[k] = temp[k];
    }

    for (let k = 0; k < radialCount; k += 1) {
      const lambda = dt * thermalDiffusivity * radiusTerm;
      if (k === 0) {
        diag[k] = 1 + 4 * lambda / (dr * dr);
        upper[k] = -4 * lambda / (dr * dr);
      } else if (k === radialCount - 1) {
        diag[k] = 1 + 2 * lambda / (dr * dr) + dt * surfaceCooling;
        lower[k] = -2 * lambda / (dr * dr);
      } else {
        const rho = k * dr;
        const radial = 1 / (2 * rho * dr);
        const second = 1 / (dr * dr);
        lower[k] = -lambda * (second - radial);
        diag[k] = 1 + 2 * lambda * second;
        upper[k] = -lambda * (second + radial);
      }
    }

    solveTridiagonal(lower, diag, upper, rhs, next, cPrime, dPrime);
    temp.set(next);

    for (let k = 0; k < radialCount; k += 1) {
      if (lockTimes[k] >= 0 || temp[k] > glassTransition) {
        continue;
      }
      const drop = previous[k] - temp[k];
      const fraction = drop > 0 ? (previous[k] - glassTransition) / drop : 1;
      lockTimes[k] = (step - 1 + clamp(fraction, 0, 1)) * dt;
    }
  }

  for (let k = 0; k < radialCount; k += 1) {
    if (lockTimes[k] < 0) {
      lockTimes[k] = stressTimeSteps * dt;
    }
  }

  return lockTimes;
}

function solveTridiagonal(lower, diag, upper, rhs, out, cPrime, dPrime) {
  const n = diag.length;

  cPrime[0] = upper[0] / diag[0];
  dPrime[0] = rhs[0] / diag[0];

  for (let i = 1; i < n; i += 1) {
    const denom = diag[i] - lower[i] * cPrime[i - 1];
    cPrime[i] = i < n - 1 ? upper[i] / denom : 0;
    dPrime[i] = (rhs[i] - lower[i] * dPrime[i - 1]) / denom;
  }

  out[n - 1] = dPrime[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) {
    out[i] = dPrime[i] - cPrime[i] * out[i + 1];
  }
}
