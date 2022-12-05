/**
* @file h5Utils.js Utilities for h5-based marker loading
* @author Christophe Avenel
* @see {@link h5Utils}
*/

/**
 * @namespace h5Utils
 * @property {Boolean} _initialized True when h5Utils has been initialized
 */
 h5Utils = {
    worker_path: 'js/utils/h5Utils_worker.js',
    relative_root: '../../'
 }

class H5_API {
    constructor() {
        this.chunkSize = 5 * 1024 * 1024;
        this.resolvers = {};
        this.count = 0; // used later to generate unique ids
        this.status = {}

        this.worker = new Worker(h5Utils.worker_path);
        this.worker.addEventListener('message', (e) => {
            let data = e.data;
            let id   = e.data["id"];
            this.resolvers[ id ](data);
            delete this.resolvers[id]; // Prevent memory leak
        });
    }
  
    loadPromise (url) {
        let requestChunkSize = this.chunkSize;
        const id = this.count++;
        let _url = url;
        if (typeof url === 'string' || url instanceof String)
            _url = h5Utils.relative_root + _url;
        this.worker.postMessage({id: id, action: "load", payload: {requestChunkSize, url:_url}});
        return new Promise(resolve => this.resolvers[id] = resolve);
    }

    load (url) {
        this.status[url] = "loading";
        this.loadPromise(url).then((data)=>{
            setTimeout(()=>{this.status[url] = "loaded";},500);
            console.log("Keys of H5 file:", data);
        })
    }

    get (url, payload, action) {
        if (action === undefined) action = "get"; 
        function sleep (time) {
            return new Promise((resolve) => setTimeout(resolve, time));
        }
        if (this.status[url] === undefined) {
            this.load(url);
        }
        return new Promise(resolve => {
            if (this.status[url] === "loading") {
                sleep(50).then (()=>{
                    this.get(url, payload, action).then((data)=>{
                        resolve(data)
                    })
                });
                return;
            }
            const id = this.count++;
            this.resolvers[id] = resolve
            payload.url = h5Utils.relative_root + url;
            this.worker.postMessage({id: id, action: action, payload: payload});
        });
    }
}

class H5AD_API  extends H5_API {
        
    getX_join (url, rowIndex, path) {
        return new Promise(resolve => {
            this.get(url,{path:path+"/categories"}).then((data_categ) => {
                this.get(url,{path:path+"/codes"}).then((data_codes) => {
                    const row = [...data_codes.value].map((x)=>data_categ.value[x]);
                    resolve(row);
                });
            });
        });
    }
        
    getXRow_categ (url, rowIndex, path) {
        return new Promise(resolve => {
            this.get(url,{path:path+"/categories"}).then((data_categ) => {
                this.get(url,{path:path+"/codes"}).then((data_codes) => {
                    const row = [...data_codes.value].map((x)=>data_categ.value[x]);
                    resolve(row);
                });
            });
        });
    }
        
    getXRow_csc (url, rowIndex, path) {
        return new Promise(resolve => {
            this.get(url,{path:path}, "attr").then((data_X) => {
                var rowLength = data_X.attrs["shape"][0];
                console.log("rowLength",rowLength);
                this.get(url,{path:path+"/indptr"}).then((indptr) => {
                    console.log(indptr);
                    let x1 = indptr.value[parseInt(rowIndex)];
                    let x2 = indptr.value[parseInt(rowIndex)+1];
                    console.log("x1,x2",x1,x2);
                    this.get(url,{path:path+"/indices", slice:[[x1,x2]]}).then((indices) => {
                        this.get(url,{path:path+"/data", slice:[[x1,x2]]}).then((data) => {
                            const row = new Float32Array(rowLength);
                            for (let i=0; i<indices.value.length;i++) {
                                row[indices.value[i]] = data.value[i];
                            }
                            resolve(row);
                        });
                    });
                });
            });
        });
    }
        
    getXRow_array (url, rowIndex, path) {
        return new Promise(resolve => {
            this.get(url,{path:path, slice:[[],[rowIndex, rowIndex+1]]}).then((data_X) => {
                resolve(data_X.value);
            });
        });
    }

    getXRow (url, rowIndex, path) {
        return new Promise(resolve => {
            this.get(url,{path:path}, "attr").then((data_X) => {
                console.log("data_X:", data_X);
                if (rowIndex == "join") {
                    this.get (url, {path:path+"/indptr"}).then((indptr)=>{
                        console.log(indptr.value);
                        this.get (url, {path:path+"/indices"}).then((indices)=>{
                            console.log(indices.value);
                            var str_array = [];
                            
                            for (let i=0; i<indptr.value.length;i++) {
                                str_array.push(
                                    indices.value.slice(indptr.value[i], indptr.value[i+1]).join(";")
                                );
                            }
                            console.log(str_array);
                            resolve(str_array);
                        });
                    });
                    return;
                }
                if (data_X.attrs === undefined) {
                    this.get (url, {path:path}).then((data)=>{
                        resolve(data);
                    });
                }
                console.log("encoding:", data_X.attrs["encoding-type"]);
                
                if (data_X.attrs["encoding-type"] == "categorical") {
                    this.getXRow_categ (url, rowIndex, path).then((data)=>{
                        resolve(data);
                    });
                }
                else if (data_X.attrs["encoding-type"] == "csc_matrix") {
                    this.getXRow_csc (url, rowIndex, path).then((data)=>{
                        resolve(data);
                    });
                }
                else if (data_X.attrs["encoding-type"] == "csr_matrix") {
                    resolve("csr sparse format not supported!")
                }
                else {
                    console.log("Unknown encoding:",data_X.attrs["encoding-type"])
                    return this.getXRow_array (url, rowIndex, path).then((data)=>{
                        resolve(data);
                    });
                }
            });
        });
    }
    
    getKeys (url, path) {
        if (path === undefined) path = "/";
        if (path[0] != "/") path = "/" + path;
        return new Promise(resolve => {
            this.get(url,{path:path}, "keys").then((data_keys) => {
                if (data_keys.type == "Dataset") {
                    let children = [];
                    if (data_keys.shape.length > 1) {
                        for (let i=0; i<data_keys.shape.length;i++){
                            children.push(path+";"+i.toString());
                        }
                    }
                    resolve({children:children});
                }
                else if (data_keys.type == "Group") {
                    resolve(data_keys);
                }
                else {
                    path = path.substring(0, Math.max(path.lastIndexOf('/'),path.lastIndexOf(';')));
                    this.getKeys(url, path).then((data_keys_root)=>{
                        resolve(data_keys_root);
                    })
                }
            });
        });
    }
}
/*
var hdf5Api = new H5AD_API()
let url = "/scANVI_kidney_object.h5ad";//"/adata_msbrain_3rep_withclusters_csc.h5ad";
hdf5Api.getKeys(url).then((data) => {
    console.log(data);
})*/
/*
hdf5Api.getXRow(url, 6, "X").then((data) => {
    console.log(data);
})
hdf5Api.loadPromise(url).then((data) => {
    console.log(data);
});*/

// Genes:   var/_index
// globalX: obsm/spatial;0
// globalY: obsm/spatial;1
// Num Obs: obs/*
// Cat Obs: obs/*/codes + obs/*/categories
