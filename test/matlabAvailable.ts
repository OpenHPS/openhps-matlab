import { execFileSync } from 'child_process';

/**
 * Whether a MATLAB executable is on PATH.
 *
 * The suites here drive a real MATLAB process. There is no MATLAB in CI — it is
 * commercial, licensed software — and without it every test failed with
 * `MATLAB executable not found!` rather than reporting itself as unrunnable. Suites
 * call this from their `before` hook and skip when it returns false.
 * @returns {boolean} true when `matlab` can be executed
 */
export function matlabAvailable(): boolean {
    try {
        execFileSync('matlab', ['-help'], { stdio: 'ignore', timeout: 10000 });
        return true;
    } catch {
        return false;
    }
}
