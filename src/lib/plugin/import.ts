import * as tsNode from 'ts-node'
import app from '../../index'
import { InternalApp } from '../../runtime/app'
import * as Start from '../../runtime/start'
import * as Layout from '../layout'
import { Dimension, DimensionToPlugin, Plugin, Manifest } from './types'
import { rootLogger } from '../nexus-logger'
import { PackageJson } from 'type-fest'
import { fatal } from '../process'
import { stripIndent } from 'common-tags'

const log = rootLogger.child('plugin')

export async function readAllPluginManifestsFromConfig(
  layout: Layout.Layout
): Promise<Manifest[]> {
  tsNode.register({
    transpileOnly: true,
  })

  // Run app to load plugins
  const runner = Start.createDevAppRunner(layout, [], {
    disableServer: true,
  })

  await runner.start()

  const plugins = validatePlugins((app as InternalApp).__state.plugins)

  log.trace('loaded plugin entrypoints', { validPlugins: plugins })

  return plugins.map(pluginToManifest)
}

export function pluginToManifest(plugin: Plugin): Manifest {
  try {
    const packageJson = require(plugin.packageJsonPath) as PackageJson

    if (!packageJson.name) {
      fatal(
        `One of your plugin has a missing required \`name\` property in its package.json`,
        {
          packageJsonPath: plugin.packageJsonPath,
          packageJson,
        }
      )
    }

    return {
      ...plugin,
      name: packageJson.name,
      packageJson,
    }
  } catch (error) {
    fatal(
      stripIndent`
       An error occured when reading the package.json of one of your Nexus plugin:

       ${error.stack ?? error}
    `,
      { plugin: plugin }
    )
  }
}

/**
 * Import the dimension of a plugin given its manifest
 */
export function importPluginDimension<D extends Dimension>(
  dimension: D,
  manifest: Manifest
): DimensionToPlugin<D> {
  // Should be guaranteed by importPluginDimensions
  if (!manifest[dimension]) {
    fatal(
      `We could not find the ${dimension} dimension of the Nexus plugin "${manifest.name}"`,
      { plugin: manifest }
    )
  }

  const dimensionEntrypoint = manifest[dimension]!

  try {
    const dimensionModule = require(dimensionEntrypoint.module)

    if (!dimensionModule[dimensionEntrypoint.export]) {
      fatal(
        `Nexus plugin "${manifest.name}" has no export \`${dimensionEntrypoint.export}\` in ${dimensionEntrypoint.module}`,
        { plugin: manifest }
      )
    }

    const plugin = dimensionModule[dimensionEntrypoint.export]

    if (typeof plugin !== 'function') {
      fatal(
        `Nexus plugin "${manifest.name}" does not export a valid ${dimension} plugin`,
        { plugin: manifest }
      )
    }

    const innerPlugin = plugin(manifest.settings)

    if (typeof innerPlugin !== 'function') {
      fatal(
        `Nexus plugin "${manifest.name}" does not export a valid ${dimension} plugin`,
        { plugin: manifest }
      )
    }

    return innerPlugin
  } catch (error) {
    fatal(
      stripIndent`
    An error occured while loading the Nexus plugin "${manifest.name}":

    ${error}
  `,
      { plugin: manifest }
    )
  }
}

/**
 * Import the dimension of several plugins given their manifests
 */
export function importPluginsDimension<D extends Dimension>(
  dimension: D,
  manifests: Manifest[]
): {
  manifest: Manifest
  plugin: DimensionToPlugin<D>
}[] {
  return manifests
    .filter((manifest) => manifest[dimension] !== undefined)
    .map((manifest) => ({
      manifest,
      plugin: importPluginDimension(dimension, manifest),
    }))
}

export function isValidPlugin(plugin: any): plugin is Plugin<any> {
  const hasPackageJsonPath = 'packageJsonPath' in plugin

  return hasPackageJsonPath
}

export function validatePlugins(plugins: Plugin<any>[]) {
  const invalids = plugins.filter((m) => !isValidPlugin(m))

  if (invalids.length > 0) {
    log.warn(
      `Some invalid plugins were passed to Nexus. They are being ignored.`,
      {
        invalidPlugins: invalids,
      }
    )
  }

  const valids = plugins.filter(isValidPlugin)

  return valids
}
