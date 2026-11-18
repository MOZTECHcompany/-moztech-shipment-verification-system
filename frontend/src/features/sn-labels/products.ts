import api from "../../api/api";
export type Product = {id:string;sku:string;name:string;barcode:string;modelNumber:string;type?:string;attributes?:Record<string,unknown>};
const path = "/api/sn-labels/products";
export const productService = {
  findAll: async ():Promise<Product[]> => (await api.get(path)).data,
  findOne: async (id:string):Promise<Product> => (await api.get(path + "/" + encodeURIComponent(id))).data,
  create: async (values:Record<string,unknown>):Promise<Product> => (await api.post(path,values)).data,
  updateSnProfile: async (id:string, values:Record<string,unknown>):Promise<Product> => (await api.put(path + "/" + encodeURIComponent(id),values)).data,
};
