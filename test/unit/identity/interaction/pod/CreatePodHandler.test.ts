import { CreatePodHandler } from '../../../../../src/identity/interaction/pod/CreatePodHandler';
import type { PodIdRoute } from '../../../../../src/identity/interaction/pod/PodIdRoute';
import { PodStore } from '../../../../../src/identity/interaction/pod/util/PodStore';
import { WebIdStore } from '../../../../../src/identity/interaction/webid/util/WebIdStore';
import type { WebIdLinkRoute } from '../../../../../src/identity/interaction/webid/WebIdLinkRoute';
import type { IdentifierGenerator } from '../../../../../src/pods/generate/IdentifierGenerator';

describe('A CreatePodHandler', (): void => {
  const name = 'name';
  const webId = 'http://example.com/other/webId#me';
  const accountId = 'accountId';
  const podId = 'podId';
  const webIdLink = 'webIdLink';
  let json: unknown;
  const baseUrl = 'http://example.com/';
  const relativeWebIdPath = '/profile/card#me';
  const podUrl = 'http://example.com/name/';
  const generatedWebId = 'http://example.com/name/profile/card#me';
  const webIdResource = 'http://example.com/.account/webID';
  const podResource = 'http://example.com/.account/pod';
  let identifierGenerator: jest.Mocked<IdentifierGenerator>;
  let webIdStore: jest.Mocked<WebIdStore>;
  let webIdLinkRoute: jest.Mocked<WebIdLinkRoute>;
  let podIdRoute: jest.Mocked<PodIdRoute>;
  let podStore: jest.Mocked<PodStore>;
  let handler: CreatePodHandler;

  beforeEach(async(): Promise<void> => {
    json = {
      name,
    };

    identifierGenerator = {
      generate: jest.fn().mockReturnValue({ path: podUrl }),
      extractPod: jest.fn(),
    };

    webIdStore = {
      isLinked: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue(webIdLink),
      delete: jest.fn(),
    } satisfies Partial<WebIdStore> as any;

    podStore = {
      create: jest.fn().mockResolvedValue(podId),
      findPods: jest.fn().mockResolvedValue([{ id: podId, baseUrl: podUrl }]),
    } satisfies Partial<PodStore> as any;

    webIdLinkRoute = {
      getPath: jest.fn().mockReturnValue(webIdResource),
      matchPath: jest.fn(),
    };

    podIdRoute = {
      getPath: jest.fn().mockReturnValue(podResource),
      matchPath: jest.fn(),
    };

    handler = new CreatePodHandler({
      webIdStore,
      podStore,
      baseUrl,
      relativeWebIdPath,
      identifierGenerator,
      webIdLinkRoute,
      podIdRoute,
      allowRoot: false,
    });
  });

  it('returns the required input fields and known pods.', async(): Promise<void> => {
    await expect(handler.getView({ accountId } as any)).resolves.toEqual({
      json: {
        pods: {
          [podUrl]: podResource,
        },
        fields: {
          name: { required: true, type: 'string' },
          settings: {
            required: false,
            type: 'object',
            fields: { webId: { required: false, type: 'string' }},
          },
        },
      },
    });

    expect(podStore.findPods).toHaveBeenCalledTimes(1);
    expect(podStore.findPods).toHaveBeenLastCalledWith(accountId);
  });

  it('generates a pod and WebID.', async(): Promise<void> => {
    await expect(handler.handle({ json, accountId } as any)).resolves.toEqual({ json: {
      pod: podUrl, webId: generatedWebId, podResource, webIdResource,
    }});
    expect(webIdStore.isLinked).toHaveBeenCalledTimes(1);
    expect(webIdStore.isLinked).toHaveBeenLastCalledWith(generatedWebId, accountId);
    expect(webIdStore.create).toHaveBeenCalledTimes(1);
    expect(webIdStore.create).toHaveBeenLastCalledWith(generatedWebId, accountId);
    expect(podStore.create).toHaveBeenCalledTimes(1);
    expect(podStore.create).toHaveBeenLastCalledWith(accountId, {
      base: { path: podUrl },
      webId: generatedWebId,
      oidcIssuer: baseUrl,
    }, false);
  });

  it('can use an external WebID for the pod generation.', async(): Promise<void> => {
    json = { name, settings: { webId }};

    await expect(handler.handle({ json, accountId } as any)).resolves.toEqual({ json: {
      pod: podUrl, webId, podResource,
    }});
    expect(webIdStore.isLinked).toHaveBeenCalledTimes(0);
    expect(webIdStore.create).toHaveBeenCalledTimes(0);
    expect(podStore.create).toHaveBeenCalledTimes(1);
    expect(podStore.create).toHaveBeenLastCalledWith(accountId, {
      base: { path: podUrl },
      webId,
    }, false);
  });

  it('errors if the account is already linked to the WebID that would be generated.', async(): Promise<void> => {
    webIdStore.isLinked.mockResolvedValueOnce(true);
    await expect(handler.handle({ json, accountId } as any))
      .rejects.toThrow(`${generatedWebId} is already registered to this account.`);
    expect(webIdStore.isLinked).toHaveBeenCalledTimes(1);
    expect(webIdStore.isLinked).toHaveBeenLastCalledWith(generatedWebId, accountId);
    expect(webIdStore.create).toHaveBeenCalledTimes(0);
    expect(podStore.create).toHaveBeenCalledTimes(0);
  });

  it('undoes any changes if something goes wrong creating the pod.', async(): Promise<void> => {
    const error = new Error('bad data');
    podStore.create.mockRejectedValueOnce(error);

    await expect(handler.handle({ json, accountId } as any)).rejects.toBe(error);

    expect(webIdStore.create).toHaveBeenCalledTimes(1);
    expect(webIdStore.create).toHaveBeenLastCalledWith(generatedWebId, accountId);
    expect(podStore.create).toHaveBeenCalledTimes(1);
    expect(podStore.create).toHaveBeenLastCalledWith(accountId, {
      base: { path: podUrl },
      webId: generatedWebId,
      oidcIssuer: baseUrl,
    }, false);
    expect(webIdStore.delete).toHaveBeenCalledTimes(1);
    expect(webIdStore.delete).toHaveBeenLastCalledWith(webIdLink);
  });

  describe('allowing root pods', (): void => {
    beforeEach(async(): Promise<void> => {
      handler = new CreatePodHandler({
        webIdStore,
        podStore,
        baseUrl,
        relativeWebIdPath,
        identifierGenerator,
        webIdLinkRoute,
        podIdRoute,
        allowRoot: true,
      });
    });

    it('does not require a name.', async(): Promise<void> => {
      await expect(handler.getView({ accountId } as any)).resolves.toEqual({
        json: {
          pods: {
            [podUrl]: podResource,
          },
          fields: {
            name: { required: false, type: 'string' },
            settings: {
              required: false,
              type: 'object',
              fields: { webId: { required: false, type: 'string' }},
            },
          },
        },
      });
    });

    it('generates a pod and WebID in the root.', async(): Promise<void> => {
      await expect(handler.handle({ json: {}, accountId } as any)).resolves.toEqual({ json: {
        pod: baseUrl, webId: `${baseUrl}profile/card#me`, podResource, webIdResource,
      }});
      expect(webIdStore.create).toHaveBeenCalledTimes(1);
      expect(webIdStore.create).toHaveBeenLastCalledWith(`${baseUrl}profile/card#me`, accountId);
      expect(podStore.create).toHaveBeenCalledTimes(1);
      expect(podStore.create).toHaveBeenLastCalledWith(accountId, {
        base: { path: baseUrl },
        webId: `${baseUrl}profile/card#me`,
        oidcIssuer: baseUrl,
      }, true);
    });
  });
});
