import * as HTTP from 'http'
import * as Lo from 'lodash'
import * as Layout from '../lib/layout'
import * as Logger from '../lib/logger'
import * as Plugin from '../lib/plugin'
import * as Schema from './schema'
import * as Server from './server'
import * as singletonChecks from './singleton-checks'

const log = Logger.create({ name: 'app' })

export type Request = HTTP.IncomingMessage & { log: Logger.Logger }

// todo the jsdoc below is lost on the destructured object exports later on...
// todo plugins could augment the request
// plugins will be able to use typegen to signal this fact
// all places in the framework where the req object is referenced should be
// actually referencing the typegen version, so that it reflects the req +
// plugin augmentations type
type ContextContributor<Req> = (req: Req) => Record<string, unknown>

export type App = {
  /**
   * [API Reference](https://nexus-future.now.sh/#/references/api?id=logger)  ⌁  [Guide](https://nexus-future.now.sh/#/guides/logging)
   *
   * ### todo
   */
  log: Logger.Logger
  /**
   * [API Reference](https://nexus-future.now.sh/#/references/api?id=server)  ⌁  [Guide](todo)
   *
   * ### todo
   *
   */
  server: Server.Server
  /**
   * todo
   */
  settings: Settings
  /**
   * [API Reference](https://nexus-future.now.sh/#/references/api?id=appschema) // [Guide](todo)
   *
   * ### todo
   */
  schema: Schema.Schema & {
    // addToContext is a bridge between two components, schema and server, so
    // its not in schema currently...

    /**
     * todo
     */
    addToContext: <Req extends any = Request>(
      contextContributor: ContextContributor<Req>
    ) => void
  }
}

type SettingsInput = {
  logger?: Logger.SettingsInput
  schema?: Schema.SettingsInput
  server?: Server.ExtraSettingsInput
}

export type SettingsData = Readonly<{
  logger: Logger.SettingsData
  schema: Schema.SettingsData
  server: Server.ExtraSettingsData
}>

/**
 * todo
 */
export type Settings = {
  /**
   * todo
   */
  original: SettingsData
  /**
   * todo
   */
  current: SettingsData
  /**
   * todo
   */
  change(newSetting: SettingsInput): void
}

/**
 * Crate an app instance
 * TODO extract and improve config type
 */
export function create(): App {
  const plugins: Plugin.RuntimeContributions[] = []
  // Automatically use all installed plugins
  // TODO during build step we should turn this into static imports, not unlike
  // the schema module imports system.
  plugins.push(...Plugin.loadAllRuntimePluginsFromPackageJsonSync())

  const contextContributors: ContextContributor<any>[] = []

  const server = Server.create()
  const schemaComponent = Schema.create({ plugins })

  const settings: Settings = {
    change(newSettings) {
      if (newSettings.logger) {
        log.settings(newSettings.logger)
      }
      if (newSettings.schema) {
        schemaComponent.private.settings.change(newSettings.schema)
      }
      if (newSettings.server) {
        Object.assign(settings.current.server, newSettings.server)
      }
    },
    current: {
      logger: log.settings,
      schema: schemaComponent.private.settings.data,
      server: Server.defaultExtraSettings,
    },
    original: Lo.cloneDeep({
      logger: log.settings,
      schema: schemaComponent.private.settings.data,
      server: Server.defaultExtraSettings,
    }),
  }

  const api: App = {
    log,
    settings,
    schema: {
      addToContext(contextContributor) {
        contextContributors.push(contextContributor)
        return api
      },
      ...schemaComponent.public,
    },
    server: {
      express: server.express,
      /**
       * Start the server. If you do not call this explicitly then nexus will
       * for you. You should not normally need to call this function yourself.
       */
      async start() {
        // Track the start call so that we can know in entrypoint whether to run
        // or not start for the user.
        singletonChecks.state.is_was_server_start_called = true

        let devModeLayout: Layout.Layout | undefined = undefined

        // During development we dynamically import all the schema modules
        // During dev mode we will dynamically require the user's graphql modules.
        // At build time we inline static imports.
        if (process.env.NEXUS_STAGE === 'dev') {
          devModeLayout = await Layout.loadDataFromParentProcess()

          await Layout.schema.importModules(devModeLayout)
        }

        const schema = await schemaComponent.private.makeSchema(devModeLayout)

        if (schemaComponent.private.isSchemaEmpty()) {
          log.warn(Layout.schema.emptyExceptionMessage())
        }

        await server.setupAndStart({
          schema,
          plugins,
          contextContributors,
          settings,
        })
      },
      stop() {
        return server.stop()
      },
    },
  }

  return api
}
