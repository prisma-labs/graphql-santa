import { introspectionQuery } from 'graphql'
import { setupE2EContext } from '../../src/utils/e2e-testing'
import { rootLogger } from '../../src/utils/logger'

rootLogger.settings({ level: 'trace' })
const log = rootLogger.child('system-test')

const ctx = setupE2EContext()

test('cli entrypoint create app', async () => {
  process.env.LOG_LEVEL = 'trace'
  process.env.CREATE_APP_CHOICE_DATABASE_TYPE = 'NO_DATABASE'
  process.env.CREATE_APP_CHOICE_PACKAGE_MANAGER_TYPE = 'npm'
  process.env.CREATE_APP_CHOICE_NEXUS_FUTURE_VERSION_EXPRESSION = `file:${ctx.getRelativePathFromCWDToLocalPackage()}`
  // because no hoist of @nexus/schema when installing local package
  // https://atmos.washington.edu/~nbren12/reports/journal/2018-07-16-NN-conservation/node_modules/npm/html/doc/cli/npm-install.html
  process.env.NEXUS_TYPEGEN_NEXUS_SCHEMA_IMPORT_PATH = `"../../nexus-future/node_modules/@nexus/schema"`

  // Create a new app

  const createAppResult = await ctx.spawnNexusFromBuild([], (data, proc) => {
    process.stdout.write(data)
    if (data.includes('server:listening')) {
      proc.kill()
    }
  })

  expect(createAppResult.data).toContain('server:listening')
  expect(createAppResult.exitCode).toStrictEqual(0)

  // Run dev and query graphql api

  await ctx.spawnNexus(['dev'], async (data, proc) => {
    if (data.includes('server:listening')) {
      const queryResult = await ctx.client.request(`{
        worlds {
          id
          name
          population
        }
      }`)
      const introspectionResult = await ctx.client.request(introspectionQuery)

      expect(queryResult).toMatchSnapshot('query')
      expect(introspectionResult).toMatchSnapshot('introspection')
      proc.kill()
    }
  })

  // Run build

  const res = await ctx.spawnNexus(['build'], () => {})

  expect(res.data).toContain('success')
  expect(res.exitCode).toStrictEqual(0)
})
