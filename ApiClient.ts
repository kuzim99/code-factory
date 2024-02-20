export enum httpMethod {
  get = 'get',
  post = 'post',
  put = 'put',
  patch = 'patch',
  delete = 'delete',
}

export default class ApiResponse<T> {
  readonly status: number;
  readonly statusText: string;
  readonly data?: T;

  readonly isSuccess: boolean;
  readonly isTokenExpired: boolean;

  constructor(status: number, statusText: string, data?: T) {
    this.status = status;
    this.statusText = statusText;
    this.data = data;

    this.isSuccess = status === 200 || status === 201 || status === 204;
    this.isTokenExpired = status === 401;
  }

  onFail(callback: (error: {status: number; statusText: string}) => void) {
    if (this.isTokenExpired) {
      return this;
    }

    if (!this.isSuccess) {
      callback({
        status: this.status,
        statusText: this.statusText,
      });
    }

    return this;
  }

  onSuccess(callback: (response: SuccessResponse<T>) => void) {
    if (this.isTokenExpired) {
      return this;
    }

    if (this.isSuccess && this.data) {
      const response = new SuccessResponse<T>(
        this.status,
        this.statusText,
        this.data,
      );

      callback(response);
    }
    return this;
  }

  onTokenExpired(callback: () => void) {
    if (this.isTokenExpired) {
      callback();
    }
    return this;
  }
}

/**
 * 응답이 성공인 경우 성공 응답
 * APIResponse 의 onSuccess 에서 사용
 */
export class SuccessResponse<T> {
  statusCode: number;
  message: string;
  data: T;

  constructor(code: number, message: string, data: T) {
    this.statusCode = code;
    this.message = message;
    this.data = data;
  }
}

export class ApiClient<T extends {[key: string]: any}, U> {
  private readonly baseUrl: string;

  private httpMethod: httpMethod = httpMethod.get;
  private url: string = '';
  private data?: T;
  private headers: {[key: string]: string} = {
    'Content-Type': 'application/json',
  };
  private token?: string;
  private interceptor: (() => void)[] = [];

  constructor(baseUrl: string = process.env.REACT_APP_API_URL ?? '') {
    this.baseUrl = baseUrl;
  }

  setMethod(method: httpMethod) {
    this.httpMethod = method;
    return this;
  }
  setUrl(url: string) {
    this.url = this.baseUrl + url;
    return this;
  }
  setData(data: T) {
    this.data = data;
    return this;
  }
  setToken(token: string) {
    this.token = token;
    this.headers['Authorization'] = `Bearer ${this.token}`;
    return this;
  }
  addHeader(header: {[key: string]: string}) {
    this.headers = {...this.headers, ...header};
    return this;
  }
  addInterceptor(interceptor: () => void) {
    this.interceptor.push(interceptor);
    return this;
  }

  async send(): Promise<ApiResponse<U>> {
    try {
      this.setUrlParams();
      this.setQueryParams();

      const config: RequestInit = {
        method: this.httpMethod,
        headers: this.headers,
        body:
          this.httpMethod !== httpMethod.get && this.data
            ? JSON.stringify(this.data)
            : undefined,
      };

      this.interceptor.forEach(interceptor => interceptor());

      const fetchResponse = await fetch(this.url, config);
      const response = (await fetchResponse.json()) as U;
      const apiResponse = new ApiResponse<U>(
        fetchResponse.status,
        fetchResponse.statusText,
        response,
      );
      console.log('apiResponse', apiResponse);
      return apiResponse;
    } catch (error: any) {
      console.log('error', error.data);
      return new ApiResponse<U>(500, 'Internal Server Error', undefined);
    }
  }

  checkResponse = async (response: Response): Promise<ApiResponse<U>> => {
    if (response.status === 401) {
      const {isSuccess, newToken} = await this.refreshAccessToken();

      if (!isSuccess || !newToken) {
        //TODO: 로그인 페이지로 이동
        return new ApiResponse<U>(401, 'Unauthorized', undefined);
      }

      this.setToken(newToken);

      return this.send();
    }

    const data = (await response.json()) as U;
    return new ApiResponse<U>(response.status, response.statusText, data);
  };

  refreshAccessToken = async () => {
    const response = await new ApiClient<
      {refreshToken: string},
      {accessToken: string; refreshToken: string}
    >()
      .setMethod(httpMethod.post)
      .setUrl('')
      .setData({refreshToken: 'refresh'})
      .send();

    this.token = response.data?.accessToken;

    return {
      isSuccess: response.isSuccess,
      newToken: response.data?.accessToken,
    };
  };

  // get 방식일 경우 query 파라미터 처리
  private setQueryParams = () => {
    if (!this.data || this.httpMethod !== httpMethod.get) {
      return;
    }
    const params = new URLSearchParams(this.data);
    this.url += `?${params.toString()}`;
    this.data = undefined;
  };

  // url 파라미터가 있는 경우 처리
  private setUrlParams = () => {
    if (!this.data) {
      return;
    }
    Object.keys(this.data).forEach(key => {
      if (this.data && this.url.includes(`{${key}}`)) {
        this.url = this.url.replace(`{${key}}`, this.data[key]);
        delete this.data[key];
      }
    });
  };
}
