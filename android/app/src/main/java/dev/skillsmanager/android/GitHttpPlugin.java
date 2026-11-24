package dev.skillsmanager.android;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(name = "GitHttp")
public class GitHttpPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(180, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .callTimeout(240, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing Git HTTP URL", "INVALID_REQUEST");
            return;
        }

        try {
            String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
            JSObject inputHeaders = call.getObject("headers", new JSObject());
            Headers.Builder headers = new Headers.Builder();
            String contentType = "application/octet-stream";
            Iterator<String> headerNames = inputHeaders.keys();
            while (headerNames.hasNext()) {
                String name = headerNames.next();
                String value = inputHeaders.getString(name);
                if (value == null || "content-length".equalsIgnoreCase(name)) continue;
                if ("content-type".equalsIgnoreCase(name)) contentType = value;
                headers.add(name, value);
            }

            RequestBody requestBody = null;
            String encodedBody = call.getString("data");
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                byte[] bytes = encodedBody == null || encodedBody.isEmpty()
                    ? new byte[0]
                    : Base64.decode(encodedBody, Base64.DEFAULT);
                requestBody = RequestBody.create(bytes, MediaType.parse(contentType));
            }

            Request request = new Request.Builder()
                .url(url)
                .headers(headers.build())
                .method(method, requestBody)
                .build();

            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call callHandle, IOException exception) {
                    call.reject("Git HTTP request failed: " + exception.getMessage(), "NETWORK", exception);
                }

                @Override
                public void onResponse(Call callHandle, Response response) {
                    try (response) {
                        byte[] bytes = response.body() == null ? new byte[0] : response.body().bytes();
                        JSObject resultHeaders = new JSObject();
                        for (String name : response.headers().names()) {
                            resultHeaders.put(name.toLowerCase(Locale.ROOT), response.headers(name));
                        }
                        JSObject result = new JSObject();
                        result.put("status", response.code());
                        result.put("url", response.request().url().toString());
                        result.put("headers", resultHeaders);
                        result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        call.resolve(result);
                    } catch (Exception exception) {
                        call.reject("Could not read Git HTTP response: " + exception.getMessage(), "NETWORK", exception);
                    }
                }
            });
        } catch (Exception exception) {
            call.reject("Could not create Git HTTP request: " + exception.getMessage(), "INVALID_REQUEST", exception);
        }
    }
}
