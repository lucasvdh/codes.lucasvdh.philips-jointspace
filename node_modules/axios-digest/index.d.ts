import { AxiosInstance, AxiosRequestConfig, AxiosStatic } from 'axios';
export declare class AxiosDigest {
    private readonly axios;
    private username;
    private passwd;
    constructor(username: string, passwd: string, customAxios?: AxiosInstance | AxiosStatic);
    info: {
        username: string;
        passwd: string;
    };
    get(path: string, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    post(path: string, data?: any, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    put(path: string, data?: any, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    delete(path: string, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    head(path: string, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    patch(path: string, data?: any, config?: AxiosRequestConfig): Promise<import("axios").AxiosResponse<any>>;
    private getWwwAuth;
    private getAuthHeader;
}
