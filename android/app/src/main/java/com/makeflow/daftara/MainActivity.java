package com.makeflow.daftara;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DaftaraFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
