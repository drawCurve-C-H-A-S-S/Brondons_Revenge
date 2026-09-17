export class ScriptManager {
  constructor(sceneAssets) {
    this.sceneAssets = sceneAssets;
  }

  listScripts() {
    return this.sceneAssets.listScripts();
  }

  createScript(name = 'new-script') {
    return this.sceneAssets.createScript(name);
  }

  attach(sceneManager, objectId, path, exportName = null) {
    const objectJSON = sceneManager.sceneJSON?.objects?.find((entry) => entry.id === objectId);
    if (!objectJSON) throw new Error(`Unknown scene object: ${objectId}`);
    const resolvedExportName = exportName || this.sceneAssets.get(path)?.exportName
      || this.sceneAssets.get(path)?.content?.match(/export class (\w+)/)?.[1]
      || 'GameScript';
    sceneManager.recordHistory();
    objectJSON.scripts = [...(objectJSON.scripts || []).filter((script) => script.path !== path), { path, export: resolvedExportName, enabled: true }];
  }

  detach(sceneManager, objectId, path) {
    const objectJSON = sceneManager.sceneJSON?.objects?.find((entry) => entry.id === objectId);
    if (!objectJSON) throw new Error(`Unknown scene object: ${objectId}`);
    sceneManager.recordHistory();
    objectJSON.scripts = (objectJSON.scripts || []).filter((script) => script.path !== path);
  }

  getAttachments(sceneManager, objectId) {
    return sceneManager.sceneJSON?.objects?.find((entry) => entry.id === objectId)?.scripts || [];
  }
}
