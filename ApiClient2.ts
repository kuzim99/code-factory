import {ApiConfig, httpMethod} from './ApiConfig';
import axios, {AxiosError, AxiosInstance} from 'axios';
import {UserDataController} from '../data/UserDataController';
import Logger from '../util/Logger';
import ApiResponse from './ApiRespone';
import {UserRefreshTokenResponse} from './backoffice/user/userApiTypes';
import {userApiConfig} from './backoffice/user/userApiConfig';

export class ApiClient<T, U> {
  private readonly config: ApiConfig;
  private readonly body: T extends Record<string, any> ? T : any;
  private readonly url: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly accessToken: string;

  private interceptor: () => void = () => {};

  constructor(
    config: ApiConfig,
    body: T extends Record<string, any> ? T : any,
    accessToken?: string,
  ) {
    this.config = config;
    this.body = body;
    this.url = this.setUrlParams(config.url, body);
    this.axiosInstance = axios.create({baseURL: process.env.REACT_APP_API_URL});
    accessToken
      ? (this.accessToken = accessToken)
      : (this.accessToken =
          UserDataController.instance.getUserData().accessToken ?? '');
  }

  private setUrlParams = (url: string, params: Record<string, any>) => {
    Object.keys(params).forEach(key => {
      // url 에 사용된 파라미터 삭제
      if (url.includes(`{${key}}`)) {
        url = url.replace(`{${key}}`, params[key]);
        delete params[key];
      }
    });
    return url;
  };

  addInterceptor = (interceptor: () => void) => {
    this.interceptor = interceptor;
    return this;
  };

  private setInterceptors = (instance: AxiosInstance) => {
    // 응답 인터셉터
    instance.interceptors.response.use(
      response => {
        const handleObject = (obj: any): void => {
          if (!obj) return;
          if (typeof obj !== 'object') return;
          Object.keys(obj).forEach(key => {
            const value = obj[key];

            // 값이 null이면 빈 문자열로 변경합니다.
            if (value === null) {
              delete obj[key];
            }
            // 값이 객체이면 재귀적으로 처리합니다.
            else if (typeof value === 'object') {
              handleObject(value);
            }

            // 키가 'ref'이면 이름을 '_ref'로 변경합니다.
            if (key === 'ref') {
              obj['_ref'] = value;
              delete obj[key];
            }
          });
        };

        handleObject(response);

        return response;
      },
      async error => {
        // 악시오스 에러가 아닌 경우는 그냥 에러를 반환
        if (!axios.isAxiosError(error) || !error.response) {
          return Promise.reject(error);
        }
        Logger.log('error.response', error.response.data);

        // 토큰 만료 시
        if (error.response.status === 401) {
          const originalRequest = error.config as any;

          // 토큰 재발급 요청
          const {isSuccess, token: newToken} = await this.refreshAccessToken();

          Logger.log('refreshAccessToken isSuccess:: ', isSuccess);

          // 토큰 재발급 성공 시 재요청
          if (isSuccess) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;

            return instance(originalRequest!);
          } else {
            return Promise.reject(error);
          }
        } else {
          return Promise.reject(error);
        }
      },
    );
  };

  send = async (): Promise<ApiResponse<U>> => {
    this.setInterceptors(this.axiosInstance);

    // url 파라미터가 있는 경우
    this.logRequest(this.config, this.url, this.body, this.accessToken);

    try {
      const response = await this.axiosInstance.request<U>({
        data: this.config.method === httpMethod.get ? undefined : this.body,
        params: this.config.method === httpMethod.get ? this.body : undefined,
        method: this.config.method,
        url: this.url,
        headers: {
          'Content-Type': this.config.contentType,
          Authorization: this.config.isTokenLess
            ? undefined
            : `Bearer ${this.accessToken}`,
        },
      });

      const apiResponse = new ApiResponse<U>(
        response.status,
        response.statusText,
        response.data,
      );

      this.logResponse(apiResponse);
      return apiResponse;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const err = error as AxiosError;
        Logger.log(err);
        Logger.log(err.code);
        Logger.log(err.status);

        const errorResponse = new ApiResponse<U>(
          err.response?.status ?? 500,
          err.message,
        );
        Logger.log('isAxiosError::::::::::::::::::::::::::::');
        this.logResponse(errorResponse, true);
        return errorResponse;
      } else {
        const errorResponse = new ApiResponse<U>(500, 'Internal Server Error');

        this.logResponse(errorResponse, true);
        return new ApiResponse<U>(500, 'Internal Server Error');
      }
    }
  };

  private refreshAccessToken = async (): Promise<{
    isSuccess: boolean;
    token?: string;
  }> => {
    const refreshTokenInstance = axios.create({
      baseURL: process.env.REACT_APP_API_URL,
    });
    const {refreshToken} = UserDataController.instance.getUserData();

    try {
      // 토큰 재발급 요청
      const response =
        await refreshTokenInstance.request<UserRefreshTokenResponse>({
          url: userApiConfig.refreshToken.url,
          method: userApiConfig.refreshToken.method,
          data: {refreshToken},
        });

      // 재발급 토큰
      const newToken = response.data.accessToken;
      const newTokenLong = response.data.refreshToken;

      // 토큰 데이터 없을 시
      if (!newToken || !newTokenLong) {
        this.failRefreshToken();
        return {isSuccess: false};
      }

      Logger.log('refreshAccessToken newToken=======================');
      Logger.log('newToken:: ', newToken);
      Logger.log('newTokenLong:: ', newTokenLong);
      Logger.log('===================================================');
      // 토큰 데이터 저장
      UserDataController.instance.saveUserData({
        accessToken: newToken,
        refreshToken: newTokenLong,
      });
      return {isSuccess: true, token: newToken};
    } catch (error) {
      Logger.log('refreshAccessToken error', error);
      this.failRefreshToken();
      return {isSuccess: false};
    }
  };

  private failRefreshToken = () => {
    //TODO: 리프래시 실패 처리
  };

  private logRequest(
    config: ApiConfig,
    url: string,
    body: any,
    accessToken?: string,
  ) {
    Logger.log('request===================================');
    Logger.log('method:: ', config.method);
    Logger.log('url:: ', url);
    Logger.log('data:: ', body);
    Logger.log('token:: ', accessToken);
    Logger.log('==========================================');
  }

  private logResponse(response: ApiResponse<any>, isError: boolean = false) {
    isError
      ? Logger.log('ErrorResponse===================================')
      : Logger.log('response===================================');
    Logger.log('response:: ', response);
    Logger.log('==========================================');
  }
}

/**
 * Secure API Client
 * PG 쪽으로 API 요청 시 사용
 */

export class ApiRequest {
  protected get uid(): number {
    return UserDataController.instance.getUserData().uid!;
  }
}
