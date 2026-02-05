/**
 * Docker image management: build, check connection, check if image exists.
 */

import Docker from 'dockerode';
import { getBaseImage, LATEST_PLAYWRIGHT_VERSION } from '../browser-versions.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';

const DEFAULT_DOCKER_IMAGE = 'vrt-playwright';

export { DEFAULT_DOCKER_IMAGE };

export async function buildDockerImage(
  dockerDir: string,
  playwrightVersion: string = LATEST_PLAYWRIGHT_VERSION
): Promise<void> {
  const docker = new Docker();
  const imageTag = `${DEFAULT_DOCKER_IMAGE}:v${playwrightVersion}`;
  const baseImage = getBaseImage(playwrightVersion);

  log.info(`Building Docker image ${imageTag} (base: ${baseImage})...`);

  const stream = await docker.buildImage(
    {
      context: dockerDir,
      src: ['Dockerfile', 'playwright-runner.js', 'batch-runner.js'],
    },
    {
      t: imageTag,
      buildargs: { PLAYWRIGHT_VERSION: playwrightVersion, BASE_IMAGE: baseImage },
    }
  );

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
      (event) => {
        if (event.stream) {
          process.stdout.write(event.stream);
        }
      }
    );
  });

  // Also tag as 'latest' if this is the latest version
  if (playwrightVersion === LATEST_PLAYWRIGHT_VERSION) {
    const image = docker.getImage(imageTag);
    await image.tag({ repo: DEFAULT_DOCKER_IMAGE, tag: 'latest' });
    log.info(`Also tagged as ${DEFAULT_DOCKER_IMAGE}:latest`);
  }

  log.info(`Docker image ${imageTag} built successfully`);
}

/**
 * Check if Docker daemon is running and accessible.
 * Returns { connected: true } or { connected: false, error: string }
 */
export async function checkDockerConnection(): Promise<
  { connected: true } | { connected: false; error: string }
> {
  const docker = new Docker();
  try {
    await docker.ping();
    return { connected: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('socket')) {
      return {
        connected: false,
        error: 'Docker is not running. Please start Docker Desktop and try again.',
      };
    }
    return { connected: false, error: `Cannot connect to Docker: ${msg}` };
  }
}

export async function checkDockerImage(imageTag?: string): Promise<boolean> {
  const docker = new Docker();
  const tag = imageTag ?? DEFAULT_DOCKER_IMAGE;

  try {
    const images = await docker.listImages({
      filters: { reference: [tag] },
    });
    return images.length > 0;
  } catch (err) {
    // Treat Docker API errors as "image not available" since we can't verify.
    // Connection errors are caught separately by checkDockerConnection() which
    // should be called first. This catch handles edge cases like invalid image
    // tag format or transient API failures.
    log.warn(`Failed to check Docker image "${tag}": ${getErrorMessage(err)}`);
    return false;
  }
}
