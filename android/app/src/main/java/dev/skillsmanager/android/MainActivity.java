package dev.skillsmanager.android;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GitHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
