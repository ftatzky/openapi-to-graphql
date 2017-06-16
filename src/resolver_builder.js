'use strict'

const request = require('request')
const Oas3Tools = require('./oas_3_tools.js')

/**
 * Creates and returns a resolver function that performs API requests for the
 * given GraphQL query.
 *
 * @param  {string} options.path         Path to invoke
 * @param  {string} options.method       Method to invoke
 * @param  {object} options.oas
 * @param  {object} options.argsFromLink Object containing the args for this
 * resolver provided through links
 * @param  {string} options.payloadName  Name of the argument to send as request
 * payload
 * @param  {object} options.data         Data produced by preprocessor.js
 * @return {function}                    Resolver function
 */
const getResolver = ({
  operation,
  oas,
  argsFromLink = {},
  payloadName,
  data
}) => {
  // determine the base URL:
  let baseUrl = Oas3Tools.getBaseUrl(oas)

  // return resolve function:
  return (root, args, ctx) => {
    // handle arguments provided by links:
    if (typeof argsFromLink === 'object') {
      for (let key in argsFromLink) {
        args[key] = root[argsFromLink[key]]
      }
    }

    // build URL (i.e., fill in path parameters):
    let urlPath = Oas3Tools.instantiatePathAndQuery(
      operation.path,
      operation.parameters,
      args)
    let url = baseUrl + urlPath

    // build request options:
    let options = {
      method: operation.method,
      url: url,
      json: true,
      headers: {}
    }

    // determine possible payload:
    // GraphQL produces sanitized payload names, so we have to sanitize before
    // lookup here:
    let sanePayloadName = Oas3Tools.beautify(payloadName)
    if (sanePayloadName in args) {
      // we need to desanitize the payload so the API understands it:
      let rawPayload = Oas3Tools.desanitizeObjKeys(
        args[sanePayloadName], data.saneMap)
      options.body = rawPayload
    }

    // do security:
    let {securityRequired, protocol} = getProtocol(operation, ctx, data)

    if (securityRequired) {
      let security = data.security[protocol]
      switch (security.def.type) {
        case 'apiKey':
          let apiKey = ctx.security[security.parameters.apiKey]
          if (typeof apiKey === 'string') {
            if ('in' in security.def) {
              if (security.def.in === 'header') {
                options.headers[security.def.name] = ctx.security[security.parameters.apiKey]
              } else if (security.in === 'query') {
              } else {
                let error = new Error(`Cannot send apiKey in ${security.def.in}`)
                console.error(error)
                throw error
              }
            }
          } else {
            let error = new Error(`Missing ${apiKey} parameter`)
            console.error(error)
            throw error
          }
          break

        case 'http':
          // var username = 'username',
          // password = 'password',
          // url = 'http://' + username + ':' + password + '@some.server.com';
          break

        case 'oauth2':
          break

        case 'openIdConnect':
          break

      }
    }

    console.log(`${options.method.toUpperCase()} ${options.url}`)
    return new Promise((resolve, reject) => {
      request(options, (err, response, body) => {
        if (err) {
          console.error(err)
          reject(err)
        } else {
          // deal with the fact that the server might send unsanitized data:
          let saneData = Oas3Tools.sanitizeObjKeys(body)
          resolve(saneData)
        }
      })
    })
  }
}

function getProtocol (operation, ctx, data) {
  let result = {}

  if (typeof operation.securityProtocols === 'object' && Object.keys(operation.securityProtocols).length > 0) {
    result.securityRequired = true
    for (let protocol in operation.securityProtocols) {
      for (let parameter in data.security[protocol].parameters) {
        if (!(data.security[protocol].parameters[parameter] in ctx.security)) {
          result.protocol = null
          return result
        }
      }
      result.protocol = protocol
    }
  } else {
    result.securityRequired = false
  }
  return result
}

module.exports = {
  getResolver
}
