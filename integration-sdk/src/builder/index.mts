import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notEmpty } from '../internal/util/index.mjs';
import RuntimeContext from './runtime-context.mjs';

const DIR_OFFSET = '/../../../../../';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TARGET_DIR = `${__dirname}${DIR_OFFSET}`;

/**
 * a configuration field
 */
export type ConfigField =
  | {
      /**
       * the name of the field
       */
      name: string;
      /**
       * a description about the field
       *
       * supports markdown
       */
      description?: string;
      /**
       * a placeholder for the field
       */
      placeholder?: string;
      /**
       * minimum height of the field
       */
      height?: number
      /**
       * the type of the field
       */
      type: /**
       * a multiline text field
       */
      | 'multiline'
        /**
         * a single line text field
         */
        | 'line'
        /**
         * a number field
         */
        | 'number'
        /**
         * a boolean text field
         */
        | 'boolean';
      /**
       * if true, the field is optional, otherwise a value is required
       */
      optional?: boolean;
      /**
       * if true, the field will NOT be encrypted
       */
      plain?: boolean;
    }
  | undefined;

/**
 * connector configuration
 */
declare type Config = {
  /**
   * a short summary about the connector
   */
  summary?: string;
  /**
   * a longer description about the connector, including further reference or setup instructions
   *
   * supports markdown
   */
  description?: string;

  /**
   * fields that can be configured by the user in the ui
   */
  fields?: {
    authorizationURL?: ConfigField;
    tokenURL?: ConfigField;
    scope?: ConfigField;
    clientId?: ConfigField;
    clientSecret?: ConfigField;
    [key: string]: ConfigField;
  };
};

/**
 * connector options
 */
declare type Options = {
  /**
   * if an endpoint is enabled for sending data to the connector
   */
  endpoint?: {
    /**
     * if the endpoint is enabled
     */
    enabled: boolean;
    /**
     * if true, the endpoint is required to operate the connector and not visible in the ui
     */
    required?: boolean;
  };
};

/**
 * OAuth configuration
 *
 * @see https://oauth.net/2/
 */
declare type OAuth = {
  /**
   * oauth2 client id
   *
   * NOTE: preferred via process.env.OAUTH_CLIENT_ID
   */
  clientId?: string;

  /**
   * oauth2 client secret
   *
   * NOTE: preferred via process.env.OAUTH_CLIENT_SECRET
   */
  clientSecret?: string;

  /**
   * @example https://example.com/oauth2/v2/auth?client_id={{clientId}}&redirect_uri={{redirectURI}}&scope={{scope}}&response_type=code
   */
  authorizationURL?: string;

  /**
   * oauth2 token url
   * @example https://example.com/oauth2/v2/token
   */
  tokenURL?: string;
  /**
   * oauth2 scope
   * @example openid offline_access
   */
  scope?: string;

  /**
   * milliseconds to automatically refresh the token, if a refresh_token is available
   *
   * @default 4 * 60 * 60 * 1000 // 4 hours
   */
  tokenRefreshPeriod?: number;

  /**
   * if true, the clientId and clientSecret are sent to the tokenURL as basic auth header
   */
  useAuthHeader?: boolean;

  /**
   * whether to enable pkce code verification
   *
   * the oauth authorization url then must contain `code_challenge_method=S256&code_challenge={{codeChallenge}}` in order to work
   */
  useCodeChallenge?: boolean;

  /**
   * if true, the client can be configured by the user
   */
  configurableClient?: boolean;

  /**
   * if true, the configurable client is optional
   */
  configurableClientOptional?: boolean;

  /**
   * if true, the connection is optional
   */
  connectionOptional?: boolean;

  /**
   * oauth2 configurable client scope
   */
  configurableClientScope?: string;

  /**
   * additional token arguments
   */
  additionalTokenArgs?: {
    /**
     * oauth2 grant type
     */
    grant_type?: string;
  };
};

/**
 * a builder for creating a connector
 */
export class Builder {
  private data: any = {
    controller: './build/.controller.json',
  };

  /**
   * configure properties of the connector
   * @param arg
   * @returns
   */
  config(arg: Config): Builder {
    this.data.config = arg;

    return this;
  }

  /**
   * configure additional options of the connector
   * @param arg
   * @returns
   */
  options(arg: Options): Builder {
    this.data.options = arg;

    return this;
  }

  /**
   * configure the authentication of the connector
   * @param arg
   * @returns
   */
  auth(arg: {oauth?: OAuth}): Builder {
    this.data.auth = arg;
    return this;
  }

  /**
   * build the connector
   * @returns
   */
  async build(): Promise<RuntimeContext> {
    await this.loadDescriptor();
    await this.checkIcon();

    // @ts-ignore
    const Controller = (await import(TARGET_DIR + 'build/controller/index.mjs')).default;

    return new RuntimeContext(new Controller(), this.data);
  }

  private async checkIcon() {
    const data = this.data;

    data.icon = TARGET_DIR + 'build/logo.png';
  }

  private async loadDescriptor() {
    notEmpty(this.data.controller, 'controller');

    const content = fs.readFileSync(this.data.controller, {
      encoding: 'utf-8',
    });
    const {text, methods, connectorId, version} = JSON.parse(content);

    this.data.types = text;
    this.data.methods = methods;

    notEmpty((this.data.id = connectorId), 'id');
    notEmpty((this.data.version = version), 'version');
  }
}
